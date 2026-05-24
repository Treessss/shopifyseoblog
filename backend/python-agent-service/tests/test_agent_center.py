from app.core.config import Settings
from app.schemas.agents import AgentRole, AgentStatus
from app.schemas.workflow import ContentWorkflowRequest
from app.services.agent_center import create_agent_center_snapshot, get_agent_center_snapshot


def test_bootstrap_agent_snapshot_exposes_doctrine_sources() -> None:
    snapshot = get_agent_center_snapshot()

    assert snapshot.orchestration_mode == "bootstrap"
    assert snapshot.doctrine_sources
    assert snapshot.open_tasks_total == len(snapshot.agents)
    assert snapshot.queued_agents_total == len(snapshot.agents)
    assert snapshot.running_agents_total == 0
    assert snapshot.blocked_agents_total == 0
    assert snapshot.workflow_completion == 0.0


def test_agent_snapshot_maps_workflow_blockers_to_roles() -> None:
    snapshot = create_agent_center_snapshot(
        ContentWorkflowRequest(
            organization_id="org_1",
            store_id="store_1",
            topic="phone case buying guide",
            primary_keyword="phone case",
            available_internal_links=0,
            available_external_references=0,
            recent_topic_count=3,
            search_console_connected=False,
        ),
        Settings(),
    )

    writer = next(agent for agent in snapshot.agents if agent.role == AgentRole.writer)
    growth = next(agent for agent in snapshot.agents if agent.role == AgentRole.growth_analyst)

    assert snapshot.orchestration_mode == "new_article"
    assert snapshot.active_agent_role == AgentRole.researcher
    assert snapshot.active_agent_name == "Research Agent"
    assert writer.status == AgentStatus.blocked
    assert writer.display_state == "blocked"
    assert writer.state_reason
    assert "internal_links" in writer.blockers
    assert "external_references" in writer.blockers
    assert growth.status in {AgentStatus.idle, AgentStatus.blocked}
    if growth.status == AgentStatus.blocked:
        assert "search_console" in growth.blockers
    assert growth.display_state in {"queued", "blocked"}
    assert snapshot.blocked_agents_total > 0
    assert snapshot.queued_agents_total > 0
    assert snapshot.open_tasks_total > 0
    assert snapshot.workflow_completion < 100


def test_agent_snapshot_marks_agents_running_when_unblocked() -> None:
    snapshot = create_agent_center_snapshot(
        ContentWorkflowRequest(
            organization_id="org_1",
            store_id="store_1",
            topic="phone case buying guide",
            primary_keyword="phone case",
            available_internal_links=4,
            available_external_references=2,
            recent_topic_count=3,
            search_console_connected=True,
        ),
        Settings(),
    )

    assert any(agent.status == AgentStatus.running for agent in snapshot.agents)
    assert any(agent.display_state == "active" for agent in snapshot.agents)
    assert snapshot.running_agents_total >= 1
    assert snapshot.active_stage == "research"
    assert snapshot.evidence_total > 0
    assert snapshot.workflow_completion == 100.0
