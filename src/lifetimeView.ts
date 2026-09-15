import type { Lifetime } from './life';
import { lifetimeReport } from './lifetimeReport';
const node = (tag: string, text: string, className?: string) => {
  const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el;
};
export function renderLifetimeHistory(host: HTMLElement, lifetimes: Lifetime[]) {
  const expanded = new Set([...host.querySelectorAll<HTMLDetailsElement>('details[open]')].map(d => d.dataset.generation));
  host.replaceChildren();
  if (!lifetimes.length) { host.append(node('p', 'First lifetime in progress. Death will archive its outcomes, experiences and learned weights.', 'empty')); return; }
  for (const life of [...lifetimes].reverse()) {
    const report = lifetimeReport(life), e = life.episode;
    const record = document.createElement('details'); record.className = 'generation-record'; record.dataset.generation = String(life.generation); record.open = expanded.has(record.dataset.generation);
    const summary = document.createElement('summary');
    summary.append(node('strong', `Generation ${String(life.generation).padStart(3, '0')}`), node('span', life.cause, 'death'), node('span', `${life.age.toFixed(1)} s survived`), node('span', `${life.reward.toFixed(2)} reward`));
    const details = node('div', '', 'generation-details');
    const outcome = node('section', ''); outcome.append(node('h3', 'What happened'));
    outcome.append(node('p', `${life.meals} meals · ${life.drinks} drinks · ${life.sleeps} rests · ${life.tasks} deliveries · ${life.eggs} eggs · ${(life.travelled * 10).toFixed(1)} mm travelled.`));
    if (e) outcome.append(node('p', `${e.encounters} predator encounters, ${e.escapes} exits survived, ${e.predatorDamage.toFixed(1)} predator damage applied. ${e.stuckRecoveries} obstacle escape attempts and ${e.falls} righting reflexes.`));
    const attempts = document.createElement('ul');
    for (const a of report.attempted) attempts.append(node('li', `${a.name}: ${a.seconds.toFixed(1)} s attempting this goal`));
    outcome.append(attempts);
    const learned = node('section', ''); learned.append(node('h3', 'What changed and was inherited'));
    learned.append(node('p', `${life.updates} goal-learning updates${report.steeringUpdates === null ? '' : ` · ${report.steeringUpdates} steering updates`}. Goal selection uses Q-learning; steering uses a policy-gradient update.`));
    if (!e?.baselineKnown) learned.append(node('p', 'This older record has no birth-weight baseline. Detailed tracking may cover only part of the lifetime. Its archived weights are available in the lineage export.'));
    else if (!report.changes.length) learned.append(node('p', 'No weight changes above 0.0001 were recorded in this lifetime.'));
    for (const w of report.changes) learned.append(node('div', `${w.name}: ${w.before.toFixed(3)} → ${w.after.toFixed(3)}`, 'weight-change'));
    learned.append(node('p', 'The next adult inherits both sets of weights, wiring interventions and recorded experiences. Improvement is measured from later outcomes; it is not guaranteed.'));
    const next = node('section', ''); next.append(node('h3', 'Next experiment'), node('p', report.next));
    if (e) next.append(node('p', `Exposure: predators ${e.predatorSeconds.toFixed(0)} s · heat ${e.heatSeconds.toFixed(0)} s · food absent ${e.foodAbsentSeconds.toFixed(0)} s · navigation assistance ${e.assistedSeconds.toFixed(0)} s.`));
    const events = node('section', '', 'record-events'); events.append(node('h3', 'Recorded experiences'));
    for (const event of life.events || []) events.append(node('p', `${event.age.toFixed(1)} s — ${event.event}`));
    if (!life.events?.length) events.append(node('p', 'No detailed event record was stored for this older generation.'));
    details.append(outcome, learned, next, events); record.append(summary, details); host.append(record);
  }
}
