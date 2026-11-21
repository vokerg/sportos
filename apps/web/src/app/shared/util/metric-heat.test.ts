import { expect, it } from 'vitest';
import { positiveMetricRange, relativePastelBackground } from './metric-heat';
it('anchors at the positive mean, preserves intensity order despite an outlier and clears zeros/missing',()=>{
 const range=positiveMetricRange([0,null,100,200,300,10000])!;
 const alpha=(n:number)=>Number(relativePastelBackground(n,range,'0, 0, 0')!.split(', ').at(-1)!.replace(')',''));
 expect(alpha(100)).toBeLessThan(alpha(200));expect(alpha(200)).toBeLessThan(alpha(300));expect(alpha(300)).toBeLessThan(alpha(10000));
 expect(alpha(range.mean)).toBe(.30);expect(alpha(range.max)).toBe(.54);
 expect(relativePastelBackground(null,range,'0, 0, 0')).toBeUndefined();
});
