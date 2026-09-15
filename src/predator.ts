/** Authored predation pressure, in habitat centimetres and accelerated seconds.
 * A moving danger footprint, not a reconstructed predator nervous system. */
export function predatorAt(age: number) {
  const phase = age % 40;
  return { active: phase >= 12 && phase < 24, x: 1.35 * Math.sin(age * .27), y: .78 * Math.cos(age * .19), radius: .34 };
}
export function predationDamage(age: number, x: number, y: number): number {
  const threat = predatorAt(age);
  const sheltered = Math.hypot(x + .9, y + .64) <= .29;
  return threat.active && !sheltered && Math.hypot(x - threat.x, y - threat.y) < threat.radius ? 32 : 0;
}
