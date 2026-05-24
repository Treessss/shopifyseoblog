from __future__ import annotations

from app.core.config import Settings
from app.domain.content.quality import evaluate_article_quality
from app.schemas.agents import AgentRole
from app.schemas.content import (
    ArticleRepairMode,
    ArticleRepairPlan,
    ArticleRepairPlanInput,
    ArticleRepairTask,
    ArticleQualityGate,
    QualityCheck,
)


def build_article_repair_plan(article: ArticleRepairPlanInput, settings: Settings) -> ArticleRepairPlan:
    quality_gate = evaluate_article_quality(article, settings)
    failed_checks = {check.key: check for check in quality_gate.checks if not check.passed}
    tasks: list[ArticleRepairTask] = []
    task_ids: set[str] = set()

    if not quality_gate.publish_ready:
        _append_content_fix_tasks(article, settings, quality_gate, failed_checks, tasks, task_ids)
    elif quality_gate.index_ready:
        _append_post_publish_tasks(article, quality_gate, tasks, task_ids)
    else:
        _append_publish_guard_tasks(article, quality_gate, tasks, task_ids)
        _append_post_publish_tasks(article, quality_gate, tasks, task_ids)

    if not tasks:
        _append_quality_guard_task(article, quality_gate, tasks, task_ids)

    mode = _repair_mode(article, quality_gate)
    summary = _summary(tasks, quality_gate)
    blockers = [check.label for check in quality_gate.checks if not check.passed and check.key in _blocking_check_keys()]
    if article.repair_reason:
        blockers.insert(0, article.repair_reason)

    return ArticleRepairPlan(
        article_id=article.article_id,
        canonical_url=article.canonical_url,
        status=article.status,
        repair_reason=article.repair_reason,
        mode=mode,
        summary=summary,
        next_step=tasks[0].instruction if tasks else quality_gate.next_step,
        blockers=_unique(blockers),
        quality_gate=quality_gate,
        tasks=tasks,
    )


def _append_content_fix_tasks(
    article: ArticleRepairPlanInput,
    settings: Settings,
    quality_gate: ArticleQualityGate,
    failed_checks: dict[str, QualityCheck],
    tasks: list[ArticleRepairTask],
    task_ids: set[str],
) -> None:
    if "content_depth" in failed_checks:
        _append_task(
            tasks,
            task_ids,
            ArticleRepairTask(
                id="writer-depth",
                agent_role=AgentRole.writer,
                priority="high",
                issue="正文太短，信息密度不够。",
                instruction="扩展正文，补充真实场景、对比、限制条件和可执行结论，把文章拉到可发布深度。",
                acceptance_check="正文长度达到 1200 字以上，并包含至少一个具体比较或购买前提醒。",
                source_check_key="content_depth",
                outputs=["expanded_body", "supporting_examples"],
            ),
        )

    if "quality_gate" in failed_checks or "editorial_quality" in failed_checks or "expert_panel" in failed_checks:
        _append_task(
            tasks,
            task_ids,
            ArticleRepairTask(
                id="seo-editor-quality-gate",
                agent_role=AgentRole.seo_editor,
                priority="high",
                issue="总质量门禁、编辑分或专家组分数未达标。",
                instruction="按质检报告逐项修订正文、标题、摘要和证据链，再重新跑质量门禁。",
                acceptance_check=f"SEO 分达到 {settings.min_publish_seo_score}+，专家组分数达到 {settings.expert_panel_pass_score}+。",
                source_check_key="quality_gate",
                outputs=["quality_gate_revision"],
            ),
        )

    if "title_intent" in failed_checks:
        _append_task(
            tasks,
            task_ids,
            ArticleRepairTask(
                id="seo-editor-title",
                agent_role=AgentRole.seo_editor,
                priority="high",
                issue="标题没有很好匹配主关键词或搜索意图。",
                instruction="重写标题，让主关键词、用途和差异点更明确，避免夸张和点击诱导。",
                acceptance_check="标题长度在 8-72 字之间，并且明确覆盖主关键词。",
                source_check_key="title_intent",
                outputs=["revised_title"],
            ),
        )

    if "summary_meta" in failed_checks:
        _append_task(
            tasks,
            task_ids,
            ArticleRepairTask(
                id="seo-editor-summary",
                agent_role=AgentRole.seo_editor,
                priority="high",
                issue="摘要或 meta 描述不够具体。",
                instruction="写一条更具体的摘要，明确承诺、适用人群和结果，不要只写空话。",
                acceptance_check="SEO 描述长度落在建议区间内，并覆盖主关键词意图。",
                source_check_key="summary_meta",
                outputs=["revised_meta_description"],
            ),
        )

    if "heading_structure" in failed_checks:
        _append_task(
            tasks,
            task_ids,
            ArticleRepairTask(
                id="writer-structure",
                agent_role=AgentRole.writer,
                priority="high",
                issue="标题层级太少或有跳级。",
                instruction="把正文拆成研究、比较、决策和 FAQ 等清晰 H2 区块，避免跳级。",
                acceptance_check="至少 3 个 H2，至少 1 个 H2 覆盖主意图，并且没有跳级。",
                source_check_key="heading_structure",
                outputs=["restructured_headings"],
            ),
        )

    if "decision_support" in failed_checks:
        _append_task(
            tasks,
            task_ids,
            ArticleRepairTask(
                id="writer-decision",
                agent_role=AgentRole.writer,
                priority="high",
                issue="文章没有给出清晰的购买决策帮助。",
                instruction="补上 choose-this-if / skip-this-if、对比表或购买前检查清单。",
                acceptance_check="文章包含明确的选择、跳过或对比建议。",
                source_check_key="decision_support",
                outputs=["decision_matrix", "buyer_guidance"],
            ),
        )

    if "faq" in failed_checks:
        _append_task(
            tasks,
            task_ids,
            ArticleRepairTask(
                id="writer-faq",
                agent_role=AgentRole.writer,
                priority="medium",
                issue="搜索意图 FAQ 太薄或不存在。",
                instruction="补 3 个以上真实买家问题，围绕适配、细节、限制和未知项直接回答。",
                acceptance_check="FAQ 至少包含 3 个真实问题和直接答案。",
                source_check_key="faq",
                outputs=["faq_section"],
            ),
        )

    if "image_alt" in failed_checks:
        _append_task(
            tasks,
            task_ids,
            ArticleRepairTask(
                id="seo-editor-alt",
                agent_role=AgentRole.seo_editor,
                priority="medium",
                issue="图片 alt 文本不够描述性。",
                instruction="把图片 alt 改成能描述具体场景、产品或对比结论的句子。",
                acceptance_check="所有图片 alt 都能说明图中具体内容，而不是只写 image/photo。",
                source_check_key="image_alt",
                outputs=["descriptive_image_alt"],
            ),
        )

    if "humanizer" in failed_checks:
        _append_task(
            tasks,
            task_ids,
            ArticleRepairTask(
                id="seo-editor-humanizer",
                agent_role=AgentRole.seo_editor,
                priority="high",
                issue="正文还有模板味、AI 话术或过度修饰。",
                instruction="删掉模板句式和空话，改成短句、具体事实和更自然的过渡。",
                acceptance_check=f"Humanizer 分数达到 {settings.min_editorial_score}+，且不再出现明显 AI 话术。",
                source_check_key="humanizer",
                outputs=["humanized_sections"],
            ),
        )

    if "helpful_content" in failed_checks:
        _append_task(
            tasks,
            task_ids,
            ArticleRepairTask(
                id="seo-editor-helpful-content",
                agent_role=AgentRole.seo_editor,
                priority="high",
                issue="内容还不够 people-first。",
                instruction="补 answer-first、verified facts、decision support、FAQ 和可靠引用，让用户真的能拿来判断。",
                acceptance_check=f"Helpful Content 分数达到 {settings.min_editorial_score}+。",
                source_check_key="helpful_content",
                outputs=["useful_content_revision"],
            ),
        )

    if "internal_links" in failed_checks:
        link_issue = failed_checks["internal_links"].detail.lower()
        role = AgentRole.researcher if "no contextual links" in link_issue or "missing" in link_issue else AgentRole.seo_editor
        _append_task(
            tasks,
            task_ids,
            ArticleRepairTask(
                id="link-internal",
                agent_role=role,
                priority="medium",
                issue="内部链接不足或锚文本不够清楚。",
                instruction="补到相关产品、集合或文章的内部链接，并使用能说明去向的锚文本。",
                acceptance_check="链接都能让读者知道会去哪里，并且与上下文相关。",
                source_check_key="internal_links",
                outputs=["descriptive_internal_links"],
            ),
        )

    if "external_references" in failed_checks:
        ref_detail = failed_checks["external_references"].detail.lower()
        role = AgentRole.researcher if "missing" in ref_detail else AgentRole.seo_editor
        _append_task(
            tasks,
            task_ids,
            ArticleRepairTask(
                id="research-external",
                agent_role=role,
                priority="medium",
                issue="外部引用不足或引用说法太泛。",
                instruction="补充经过批准的外部引用，并把每条引用和具体事实、趋势或数据点绑在一起。",
                acceptance_check="每条外部引用都能说明来源、时间或具体依据。",
                source_check_key="external_references",
                outputs=["approved_external_references"],
            ),
        )

    if "search_review" in failed_checks:
        _append_task(
            tasks,
            task_ids,
            ArticleRepairTask(
                id="seo-editor-search-review",
                agent_role=AgentRole.seo_editor,
                priority="medium",
                issue="AI 搜索复盘分数不够。",
                instruction="针对搜索意图、标题点击和内容深度重写关键段落，提升搜索判断分。",
                acceptance_check=f"AI 搜索分达到 {settings.min_publish_seo_score}+。",
                source_check_key="search_review",
                outputs=["search_review_revision"],
            ),
        )

    _sort_tasks(tasks)


def _append_publish_guard_tasks(
    article: ArticleRepairPlanInput,
    quality_gate: ArticleQualityGate,
    tasks: list[ArticleRepairTask],
    task_ids: set[str],
) -> None:
    needs_online_url = article.status != "published" or not article.has_canonical_url or not article.canonical_url
    if needs_online_url:
        _append_task(
            tasks,
            task_ids,
            ArticleRepairTask(
                id="publisher-guard",
                agent_role=AgentRole.publisher_guard,
                priority="high",
                issue="内容已过发布线，但还缺少可验证的线上 canonical URL。",
                instruction="先发布或补齐 Shopify canonical URL，再把文章交给 Search Console 观察。",
                acceptance_check="生成可访问的 canonical URL，并完成一次发布动作。",
                source_check_key="canonical",
                outputs=["canonical_url", "publish_ready"],
            ),
            depends_on=[task.id for task in tasks],
        )


def _append_post_publish_tasks(
    article: ArticleRepairPlanInput,
    quality_gate: ArticleQualityGate,
    tasks: list[ArticleRepairTask],
    task_ids: set[str],
) -> None:
    if article.status == "published" or quality_gate.publish_ready:
        depends_on = ["publisher-guard"] if "publisher-guard" in task_ids and not quality_gate.index_ready else []
        _append_task(
            tasks,
            task_ids,
            ArticleRepairTask(
                id="growth-analyst",
                agent_role=AgentRole.growth_analyst,
                priority="medium",
                issue="文章已具备观察基础，但还需要用真实表现来继续优化。",
                instruction="同步 Search Console，查看曝光、CTR、平均排名和查询缺口，再决定要不要刷新。",
                acceptance_check="拿到 Search Console 数据后能列出 3 个可操作的修复或扩写方向。",
                source_check_key="search_console",
                outputs=["search_console_insights", "refresh_candidates"],
            ),
            depends_on=depends_on,
        )


def _append_quality_guard_task(
    article: ArticleRepairPlanInput,
    quality_gate: ArticleQualityGate,
    tasks: list[ArticleRepairTask],
    task_ids: set[str],
) -> None:
    _append_task(
        tasks,
        task_ids,
        ArticleRepairTask(
            id="seo-editor-review",
            agent_role=AgentRole.seo_editor,
            priority="medium",
            issue="当前没有单一明显缺口，但文章仍需要人工复核。",
            instruction="复核质量门禁、品牌语气和结构，再决定是否发布或继续修订。",
            acceptance_check="修复任务和质量门禁都已经人工确认过。",
            source_check_key="quality_gate",
            outputs=["editorial_review_notes"],
        ),
    )


def _repair_mode(article: ArticleRepairPlanInput, quality_gate: ArticleQualityGate) -> ArticleRepairMode:
    if article.status == "published":
        return ArticleRepairMode.post_publish_refresh
    if quality_gate.publish_ready:
        return ArticleRepairMode.publish_and_index
    return ArticleRepairMode.pre_publish_repair


def _summary(tasks: list[ArticleRepairTask], quality_gate: ArticleQualityGate) -> str:
    if not tasks:
        return "No repair tasks were generated."
    agent_roles = ", ".join(_unique([task.agent_role.value for task in tasks[:3]]))
    return f"{len(tasks)} repair task(s) across {agent_roles}."


def _append_task(
    tasks: list[ArticleRepairTask],
    task_ids: set[str],
    task: ArticleRepairTask,
    *,
    depends_on: list[str] | None = None,
) -> None:
    if task.id in task_ids:
        return
    task.depends_on = _unique(depends_on or [])
    tasks.append(task)
    task_ids.add(task.id)


def _sort_tasks(tasks: list[ArticleRepairTask]) -> None:
    priority_rank = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    role_rank = {
        AgentRole.writer: 0,
        AgentRole.seo_editor: 1,
        AgentRole.researcher: 2,
        AgentRole.publisher_guard: 3,
        AgentRole.growth_analyst: 4,
        AgentRole.keyword_planner: 5,
    }
    tasks.sort(key=lambda task: (priority_rank.get(task.priority, 9), role_rank.get(task.agent_role, 9), task.id))


def _blocking_check_keys() -> set[str]:
    return {
        "content_depth",
        "title_intent",
        "summary_meta",
        "heading_structure",
        "editorial_quality",
        "humanizer",
        "helpful_content",
        "expert_panel",
        "internal_links",
        "external_references",
        "search_review",
        "decision_support",
        "faq",
        "image_alt",
    }


def _unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        output.append(value)
    return output
