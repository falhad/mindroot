// jsdom has no canvas; measure.ts falls back to a width estimate when getContext is null.
HTMLCanvasElement.prototype.getContext = (() => null) as never
