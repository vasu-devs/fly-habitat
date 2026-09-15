// habitatFixtures.ts — the habitat's physical collision boxes, shared by
// tools/compile-habitat.mjs (offline MJB) and the browser fallback that
// compiles the body from the flybody bundle when no compiled model is hosted.
// All sizes are centimetres: [name, x, y, z, half-x, half-y, half-z].
// Wide doorways connect four zones; divider stubs stay within 2 mm of the
// outer walls so straight routes between zones are clear of the legs.

export const HABITAT_BOXES: [string, number, number, number, number, number, number][] = [
  ['back', 0, 1.18, .2, 1.7, .04, .35],
  ['front', 0, -1.18, .04, 1.7, .04, .19],
  ['left', -1.7, 0, .2, .04, 1.18, .35],
  ['right', 1.7, 0, .2, .04, 1.18, .35],
  ['divider-back', 0, 1.04, -.01, .03, .1, .14],
  ['divider-front', 0, -1.04, -.01, .03, .1, .14],
  ['divider-left', -1.56, 0, -.01, .1, .03, .14],
  ['divider-right', 1.56, 0, -.01, .1, .03, .14],
];

/** MJCF geoms for the fixtures, to be inserted before `</worldbody>`. */
export function habitatFixturesXml(): string {
  return HABITAT_BOXES.map(([name, x, y, z, a, b, c]) =>
    `<geom name="habitat-${name}" type="box" pos="${x} ${y} ${z}" size="${a} ${b} ${c}" rgba=".38 .44 .36 1" friction="1 .005 .0001"/>`).join('\n');
}
