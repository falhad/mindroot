// jsdom has no canvas; measure.ts falls back to a width estimate when getContext is null.
if (typeof HTMLCanvasElement !== 'undefined') HTMLCanvasElement.prototype.getContext = (() => null) as never
