import { ACTIONS, FEATURE_NAMES, PLACES, type Lifetime } from './life.ts';
const STEER_NAMES = ['other odor L−R', 'PN L−R', 'LHN L−R', 'visual projection L−R', 'optic L−R', 'descending L−R', 'goal odor L−R'];
export function lifetimeReport(life: Lifetime) {
  const e = life.episode;
  const changes: { name: string; before: number; after: number; delta: number }[] = [];
  if (e?.baselineKnown && life.weights && life.steer) {
    life.weights.forEach((row, a) => row.forEach((after, f) => {
      const before = e.startWeights[a][f];
      if (Math.abs(after - before) > .0001) changes.push({ name: `${ACTIONS[a]} / ${FEATURE_NAMES[f]}`, before, after, delta: after - before });
    }));
    life.steer.forEach((after, i) => {
      const before = e.startSteer[i];
      if (Math.abs(after - before) > .0001) changes.push({ name: `steering / ${STEER_NAMES[i]}`, before, after, delta: after - before });
    });
  }
  changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const attempted = e ? e.actionSeconds.map((seconds, i) => ({ name: PLACES[i].name, seconds })).filter(a => a.seconds > 0).sort((a, b) => b.seconds - a.seconds) : [];
  const next = life.cause === 'predation' ? 'Compare shelter use and predator encounters in the next lifetime.'
    : life.cause === 'starvation' ? 'Compare time spent seeking fruit with completed meals; check whether food was available.'
    : life.cause === 'dehydration' ? 'Compare water-seeking time, completed drinks and survival age.'
    : life.cause === 'exhaustion' ? 'Compare refuge visits and completed rests.'
    : life.cause === 'heat exposure' ? 'Compare survival with the same heat exposure and inherited weights.'
    : 'Compare survival time, reward and completed tasks under the same conditions.';
  return { attempted, changes: changes.slice(0, 6), next, steeringUpdates: e?.baselineKnown ? Math.max(0, life.steerUpdates - e.startSteerUpdates) : null };
}
