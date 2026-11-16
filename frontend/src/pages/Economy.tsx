import { ECONOMY_NAV } from '../shell/nav'
import { AppIcon } from '../components/AppIcon'
import './knowledge.css'
import './economy/economy.css'

const workflow = [
  ['周线', '判断趋势环境'],
  ['日线', '确认量价结构'],
  ['分时', '观察尾盘承接'],
  ['总结', '评估进场条件'],
]

export default function Economy() {
  return (
    <div className="knowledge-start economy-start" data-page="economy">
      <nav className="knowledge-start__actions" aria-label="经济研究入口">
        {ECONOMY_NAV.map(item => (
          <a className="knowledge-entry" key={item.path} href={`#${item.path}`}>
            <span className="knowledge-entry__icon"><AppIcon name={item.icon} size={20} /></span>
            <strong className="knowledge-entry__title">{item.label}</strong>
            <span className="knowledge-entry__desc">{item.description}</span>
            <span className="knowledge-entry__open">进入<AppIcon name="arrow-right" size={14} /></span>
          </a>
        ))}
      </nav>
      <section className="economy-start__workflow" aria-labelledby="economy-workflow-title">
        <h2 id="economy-workflow-title">隔夜策略观测流程</h2>
        <ol className="economy-start__flow">
          {workflow.map(([title, description], index) => (
            <li key={title}>
              <span aria-hidden="true">{index + 1}</span>
              <div><strong>{title}</strong><p>{description}</p></div>
            </li>
          ))}
        </ol>
        <p className="economy-start__note">机会评分用于比较进场条件，不代表获利概率。</p>
      </section>
    </div>
  )
}
