import { z } from 'zod';

// Zod schemas shared by several tools and by the index file format.

export const abapUriSchema = z
  .string()
  .regex(/^abap:/i, 'Must be an abap:// URI as returned by another abap-mirror tool.')
  .max(2000);

export const sourcePartSchema = z.enum(['main', 'definitions', 'implementations', 'macros', 'testclasses', 'other']);

export const indexEntrySchema = z.object({
  name: z.string(),
  type: z.string(),
  package: z.string(),
  uri: z.string(),
});

export const diagnosticSchema = z.object({
  severity: z.enum(['error', 'warning', 'info', 'hint']),
  line: z.number().int(),
  message: z.string(),
});
