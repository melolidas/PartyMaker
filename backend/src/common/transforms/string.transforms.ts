import type { TransformFnParams } from 'class-transformer';

function transformString(
  value: unknown,
  transform: (input: string) => string,
): unknown {
  return typeof value === 'string' ? transform(value) : value;
}

export function toTrimmedString({ value }: TransformFnParams): unknown {
  return transformString(value, (input) => input.trim());
}

export function toTrimmedLowercase({ value }: TransformFnParams): unknown {
  return transformString(value, (input) => input.trim().toLowerCase());
}

export function toTrimmedUppercase({ value }: TransformFnParams): unknown {
  return transformString(value, (input) => input.trim().toUpperCase());
}
