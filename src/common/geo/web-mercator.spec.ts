import { tilesCovering } from './web-mercator.js';

describe('tilesCovering', () => {
  it('devuelve las teselas que cubren Ecuador a zoom 5', () => {
    const tiles = tilesCovering([-92, -5.1, -75.1, 1.5], 5).map(({ x, y }) => `${x}/${y}`);
    expect(tiles.sort()).toEqual(['7/15', '7/16', '8/15', '8/16', '9/15', '9/16']);
  });

  it('un punto cae en una sola tesela', () => {
    expect(tilesCovering([-78.5, -0.2, -78.5, -0.2], 7)).toEqual([{ z: 7, x: 36, y: 64 }]);
  });
});
