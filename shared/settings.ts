import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const reviewSettings = defineSettings({
  id: "editor",
  scope: "host",
  version: 1,
  schema: z.object({
    editorExecutable: z
      .string()
      .trim()
      .min(1, "Enter an executable name or full path.")
      .max(1024)
      .refine((value) => !/[\0\r\n]/.test(value), "Enter a single executable name or path.")
      .default("code"),
  }),
});
