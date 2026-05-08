import { Megaphone, Plus } from "lucide-react";
import { Badge, PageHeader, Panel, ProgressBar } from "@/components/ui";
import { campaigns } from "@/lib/admin-data";

export default function CampaignsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Campaigns"
        title="内容任务"
        description="把商品、集合或手动主题组织为多语言 Blog 生产任务，并绑定发布策略。"
        action={
          <button className="button button--primary">
            <Plus size={16} aria-hidden="true" />
            新建任务
          </button>
        }
      />

      <Panel title="任务队列" description="任务状态将驱动 worker 生成、质检、配图和发布。">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>任务</th>
                <th>店铺</th>
                <th>来源</th>
                <th>语言</th>
                <th>进度</th>
                <th>发布策略</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr key={campaign.name}>
                  <td>
                    <strong>{campaign.name}</strong>
                  </td>
                  <td>{campaign.store}</td>
                  <td>{campaign.source}</td>
                  <td>{campaign.locale}</td>
                  <td>
                    <ProgressBar value={campaign.progress} />
                  </td>
                  <td>{campaign.publishPolicy}</td>
                  <td>
                    <Badge tone={campaign.status === "active" ? "good" : campaign.status === "paused" ? "warn" : "neutral"}>
                      {campaign.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel compact>
        <div className="list-item" style={{ marginTop: 16 }}>
          <Megaphone size={18} aria-hidden="true" />
          <div>
          <strong>批量生产节奏</strong>
          <small className="muted">按队列容量分配生成、质检与发布窗口，避免集中触发限流。</small>
          </div>
        </div>
      </Panel>
    </>
  );
}
