import { z } from "zod";
import { snapshotRpc, type ReviewSnapshot } from "../shared/review";

const contextLine = z.object({
  oldLineNumber: z.number().int().positive().nullable(),
  newLineNumber: z.number().int().positive().nullable(),
  type: z.enum(["context", "add", "remove"]),
  content: z.string(),
});
const commentDraft = z.object({
  id: z.string(),
  path: z.string(),
  root: z.string(),
  fingerprint: z.string(),
  editing: z.boolean(),
  input: z.string().optional(),
  comment: z.object({
    filePath: z.string(),
    side: z.enum(["old", "new"]),
    lineNumber: z.number().int().positive(),
    body: z.string(),
    context: z.object({
      hunkHeader: z.string(),
      targetLine: contextLine,
      lines: z.array(contextLine),
    }),
  }),
});
export const reviewTabSchema = z
  .object({
    version: z.literal(1),
    initialized: z.boolean(),
    diffStyle: z.enum(["unified", "split"]),
    overflow: z.enum(["wrap", "scroll"]),
    filter: z.string(),
    unviewedOnly: z.boolean(),
    collapsed: z.array(z.string()),
    activePath: z.string().nullable(),
    draft: z
      .object({
        snapshot: snapshotRpc.output,
        path: z.string(),
        contents: z.string(),
      })
      .nullable(),
    comments: z.array(commentDraft),
  })
  .refine(
    (state) =>
      state.draft === null ||
      state.draft.snapshot.files.some(
        (file) => file.path === state.draft!.path && file.editable && file.fingerprint !== null,
      ),
    { message: "The saved edit must belong to its captured file." },
  );
export type ReviewTabState = z.infer<typeof reviewTabSchema>;
export type EditDraft = NonNullable<ReviewTabState["draft"]>;

export const defaultReviewTabState: ReviewTabState = {
  version: 1,
  initialized: false,
  diffStyle: "unified",
  overflow: "wrap",
  filter: "",
  unviewedOnly: false,
  collapsed: [],
  activePath: null,
  draft: null,
  comments: [],
};

/** Keep only the edited file's captured bytes; other files are read again on opening. */
export function persistedReviewState(state: ReviewTabState): ReviewTabState {
  return reviewTabSchema.parse({
    ...state,
    draft: state.draft && {
      ...state.draft,
      snapshot: {
        ...state.draft.snapshot,
        files: state.draft.snapshot.files.filter((file) => file.path === state.draft!.path),
      },
    },
  });
}

export function reviewHasDrafts(state: Pick<ReviewTabState, "draft" | "comments">): boolean {
  return state.draft !== null || state.comments.length > 0;
}

/** A restored draft must match fresh captured bytes before receiving a new save token. */
export function currentDraftSnapshot(draft: EditDraft, current: ReviewSnapshot): string {
  const original = draft.snapshot.files.find((file) => file.path === draft.path);
  const latest = current.files.find((file) => file.path === draft.path);
  if (
    current.root !== draft.snapshot.root ||
    !original?.fingerprint ||
    !latest?.editable ||
    latest.fingerprint !== original.fingerprint
  )
    throw new Error(
      "File changed since this draft was started. Your draft is kept; Cancel and refresh to load the current file.",
    );

  return current.id;
}
