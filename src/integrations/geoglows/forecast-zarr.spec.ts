import { UpstreamError } from '../../common/http/upstream.error.js';
import { parseS3Listing, timeBaseMs } from './forecast-zarr.js';

describe('parseS3Listing', () => {
  it('toma las carpetas de corrida y el token para la página siguiente', () => {
    const xml = `<ListBucketResult><IsTruncated>true</IsTruncated>
      <CommonPrefixes><Prefix>2024070100.zarr/</Prefix></CommonPrefixes>
      <CommonPrefixes><Prefix>2024070200.zarr/</Prefix></CommonPrefixes>
      <CommonPrefixes><Prefix>otra-cosa/</Prefix></CommonPrefixes>
      <NextContinuationToken>abc123</NextContinuationToken></ListBucketResult>`;
    expect(parseS3Listing(xml)).toEqual({ dates: ['20240701', '20240702'], nextToken: 'abc123' });
  });

  it('sin más páginas no devuelve token', () => {
    expect(parseS3Listing('<IsTruncated>false</IsTruncated><Prefix>2026100100.zarr/</Prefix>').nextToken).toBeNull();
  });
});

describe('timeBaseMs', () => {
  it('lee la fecha base de "seconds since"', () => {
    expect(timeBaseMs('seconds since 2026-10-01')).toBe(Date.parse('2026-10-01T00:00:00Z'));
    expect(timeBaseMs('seconds since 2026-10-01 00:00:00')).toBe(Date.parse('2026-10-01T00:00:00Z'));
  });

  it('rechaza otras unidades', () => {
    expect(() => timeBaseMs('days since 1970-01-01')).toThrow(UpstreamError);
  });
});
