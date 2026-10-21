# Task 33 review: section layout, dividers, shelves/rod/baskets, back panels (df47c69..3463fa9)

Evidence gap for the controller: `review-df47c69..3463fa9.diff` is 0 bytes. The /tmp filesystem was full when the review started, so the file was probably truncated then. I regenerated the diff with `git diff df47c69..3463fa9` (13 files, +3130/-14) and reviewed from that.

## Spec Compliance

- ✅ The code matches the letter of 07 §3.4, §3.4.1, §3.7–§3.11, §6.7, the §7.3 severities and the §12.2/§12.4 values. Every item in the brief's interface list exists with the stated signature: `layout.ts` 567-911, `contents.ts` 298-544, `back.ts` 71-250, `sheetFit.ts` 935-953, `index.ts` 1151-1157. I did not re-flag the accepted controller rulings.
- ⚠️ One ruling is needed (I1). The accepted interior-x clamp for the shelf-cover test fixes back strips that run into the side grooves. It does not fix the same problem at partitions. A strip bounded by a partition centre can never be covered by the fixed shelves of its own column. The code follows the spec text here, but this is the same intent gap the clamp ruling was meant to close.
- ⚠️ Cannot verify from this diff: whether Task 36 (`generateFurniture`) pushes `ctx.sections` a second time. The report says "Task 34" in two places, but `generateFurniture` belongs to Task 36. Carry the note "layoutFromEnvelope fills ctx.sections" into the Task 36 brief.

## Strengths

- `allocate` (`layout.ts:631-676`) follows the §3.7 rule order:
  - fallback weights mix fixed mm with flex weights;
  - leftover millimetres go +1 to flex children only, first flex child first;
  - in the all-fixed case the last child absorbs `rem`, and `adjusted` is set when `rem !== 0`.

  I checked `[fixed 100, flex, fixed 50, flex, flex]` in 1000, which gives `[100, 284, 50, 283, 283]`. I also checked weights `[1, 2, 1]` in 1003 (`[251, 502, 250]`) and the mixed fallback `[fl(600000/1101), fl(1000/1101), fl(500000/1101)]`.
- `recordEndJoints` (`layout.ts:838-879`) is one generic, geometric routine, used by both the dividers and the non-adjustable shelves. In it:
  - the face test runs against the far-side face only, so an overlapping body never matches;
  - every across-axis overlap must be positive;
  - each member/other pair is recorded once;
  - the joint length is the shared edge.
- `back.ts` keeps the greedy split as one pure `greedySeams` function, used for both axes. Piece numbering, seam keys, the `back_split` count and the `fitsSheet` grain derivation (`grainOf` mirrors makePart's square-part rule) all match §3.4.1.
- The tests are strong. 90 hand-made mutants over the new code, the Task 32 minors and `sheetFit` (all listed below) are almost all killed. The tests assert full objects: boxes, joints in order, issue payloads and hardware lines.

## Checks run (scratch copy only; worktree untouched, HEAD still 3463fa9, `git status` clean)

Scratch copy: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv33`. It was built with `git archive 3463fa9` and has `node_modules` symlinked. Baseline run: furniture suite 13 files, 301 tests, all passing. The extra tests are kept at `.../rv33/rvextra.test.ts.bak`.

### 1. §3.7 allocation

- All rules are correct (cases above).
- Mutants killed:
  - leftover `> 1`;
  - leftover given to fixed children;
  - fallback `round`;
  - `adjusted` always set;
  - `rem <= 0`;
  - `overBy` sign;
  - `td` always `tc`;
  - label `parentLabel`;
  - sibling index.

### 2. §3.8 joint discovery (scratch cases)

- **Corner or edge contact only.** A partition end meets a panel whose x-range starts at the partition's far face, or the two touch only along the z = 500 edge. Result: no joint (correct).
- **Face tolerance.** A 0.5 mm gap gives a joint. A 0.6 mm gap gives none. A panel whose min face sits at the member's end, so it overlaps the member's body, gives none.
- **Partial overlap.** The joint length is the shared 300 mm. Calling `recordEndJoints` twice still records one joint.
- **3-level nesting** `columns[A | B rows[B1 columns[C | D] / B2]]` in 1500 × 1000 × 560:
  - The root partition joins `carcass.bottom` and `carcass.top` (547 each).
  - The `s2` fixed shelf runs through and joins the root partition and `side.right`.
  - The grandchild partition ends on that fixed shelf and on `carcass.top`.
  - A non-adjustable shelf in D joins the grandchild partition and `side.right`, length 527 (the shelf depth).
  - Pin holes go to the right verticals: C's go to the root partition and the nested partition; A's go to `side.left` and the root partition.
  - `ctx.sections` are the leaves in pre-order.
- **Partition meeting a fixed shelf.** Whichever split is the ancestor runs through. A rows-parent fixed shelf ends on the sides, and the child partition ends on the shelf. A columns-parent partition ends on top/bottom, and the child fixed shelf ends on the partition. Both are covered by the committed tests (`layout.test.ts` 312-466) and by my 3-level case.
- **Wardrobe.** Exactly 8 joints, all length 569. This matches the §12.2 "8 joints × 2 cams".
- **Mutants killed:** joint length `min`; other-face swap; tolerance 30; dividers unbanded.
- **Mutant survivors:** see M1, M2. Two more survivors are equivalent:
  - Removing the dedupe (`layout.ts:866`) is unreachable in the pipeline, because a single box cannot touch both ends of a member.
  - Recording joints inline (dropping the two-phase loop, `layout.ts:909-910`) is equivalent too. `layout.dividers` lists parent dividers before child dividers, and a divider only ends on an ancestor's divider. The comment on line 909 overstates the need, but this is harmless.

### 3. §3.9–§3.11

- Shelf boxes, clearance, y formula and setback/inset depth are correct.
- `4 × n` supports, and `2·pr` holes per bounding vertical.
- Rod `ceil` pieces, `2 × pieces` supports, and the three warning boundaries (`>` / `<`).
- Basket width range, `minDepthMm ?? 450`, and `count × 150 > h`.
- All mutants on these were killed. Survivors: M3 and M4.

### 4. §3.4 / §3.4.1 back and `fitsSheet`

The following were all killed:
- the `Px` choice (three mutants);
- the `MIN_PIECE` value and the `MIN_PIECE` / `maxSpan` boundaries;
- choosing the largest supported candidate;
- the interior clamp (both ends);
- groove x/z;
- the single-piece key and `nameParams`;
- the even-split `ceil`;
- the seam axis and seam keys;
- the full-height filter (both ends);
- partition and shelf centres;
- trim;
- `locked`;
- `grainOf`;
- `part_exceeds_sheet_back`;
- the `back_split` condition;
- the `fitsSheet` grain branches, trim and boundary.

One mutant was equivalent: `bh > usableLength ? … : []` changed to always split, which the greedy loop guard makes identical.

### 5. Task 32 minors

Every mutant from the Task 32 review is now killed:
- M1 grain: side, top, plinth front, plinth back, return, countertop.
- M2: return `x0`, and front/back `x0`.
- M3: `t('front')` → carcass, and `t('plinth')` → carcass.
- M4: `!bottomOver`.
- M5: `fz` ignoring `hasSliding`.
- M6: the zero-height plinth guard.

M7 was a process note and needs no code.

## §3.10 rod cylinder: where it belongs

The implementer is right that it has no home in the engine model. 03 §3.1 fixes the `FurnitureModel` shape (parts, hardware, fronts, sections, bbox, issues), and it has no primitive or rod field. 07 §8.4 puts the cylinder in the editor: "Hanging rods, handles, legs and hinges are rendered from hardware lines using simple primitives (cylinder, rounded box)". That is the job of `three/buildFurnitureObject.ts` (07 §0.2), used by `views/Preview3D.vue`, and possibly the GLB export in §11.3.

Owner: the P5 furniture-builder task that implements `buildFurnitureObject` and Preview3D. It should not be Task 34 or Task 36.

There is a spec gap to carry into P5. The cylinder needs `y = y1 − topClearance` and `z = z0 + cd/2`. `topClearance` lives only in the document, and `cd` depends on whether an inset front covers the section. Neither can be derived from `model` + `catalogIndex`, which is the signature in §8.4. The P5 plan should pass the document (or an engine helper such as `rodPrimitives(doc, model)`) in `options`. Record this in the reconciliation log.

## Issues

### Critical (Must Fix)
None.

### Important (Should Fix)

- **I1 (needs a controller ruling): the y-seam support test ignores fixed shelves when the strip edge is a partition centre** (`back.ts:146-157`).
  - **What happens.** Vertical seams land on partition centres. So a strip spans, for example, x [609, 1789]. The column's fixed shelves span only from the partition face, [618, 1782]. Even after the accepted interior clamp, `d.box.min[0] <= from` fails. The y seam therefore falls back to an unsupported even split, and the fixed shelf is ignored.
  - **Reproduction.** Scratch test: 1800 × 2700 × 600 grooved box, two flex columns, each `rows[fixed 1300 / flex]`. Fixed shelves are at y [1364, 1382] (centre 1373).
    - Result: 4 pieces with y seams at 1350, and two `back_seam_unsupported { axis: 'y', position: 1350 }` warnings.
    - If the shelves counted, the greedy rule would pick 1373 (supported, no warning). The cut pieces would also differ: a joint 14 mm below the shelf instead of behind it.
  - **Reachability.** The `wardrobe_hinged` template allows heights up to 2700. At plinth 100 the grooved back is 2578 high, which is more than 2420. So the double-door column's fixed shelf (rows `fixed 350`) is never used as a seam support. That is a spurious warning and a misplaced cut-list seam on a template configuration.
  - **Spec position.** The spec text ("x-range covers the strip completely") matches the code. The behaviour is wrong by the same reasoning that justified the accepted side-groove clamp.
  - **Fix.** When a strip edge is a supported vertical seam, move that edge to the partition's face (±td/2) before the cover test, the same way the edge is clamped to `ix0` / `ix1` at the sides. Add the 2700-high case as a test.

### Minor (Nice to Have)

- **M1: corner-only contact is not tested** (`layout.ts:864`). Changing `o <= OVERLAP_EPSILON` to `o < 0` survives, so zero-overlap contact is never exercised. The brief's "dividers that touch only at a corner" case has no test. The code is correct (my scratch case passes). Add the edge-contact case.
- **M2: the 0.5 mm face tolerance is not tested** (`layout.ts:614`). `FACE_TOLERANCE = 0.01` survives. Add a 0.5 / 0.6 mm pair.
- **M3: the bounding-vertical y/z overlap filters are not tested** (`contents.ts:373-374`). Deleting the y-overlap check survives. The case that needs it: `rows[columns[a | b] / columns[c | d]]` with equal widths puts both partitions at the same x. Without the check, the pins for leaf `d` would go to the row-1 partition, the first found. Add that layout.
- **M4: two survivors in rows of 3.**
  - The rod fallback when the spec has no `maxLengthMm` (`contents.ts:470-473`, `ROD_MAX_SPAN` → 1000 survives) is not tested.
  - Flooring of the `ctx.sections` sizes (`layout.ts:727`) is not tested.
- **M5: the content depth `cd` is written out three times** (`contents.ts:398-399`, `465`, `509`), each as `depthTotal - insetReduction(ctx, leaf.id)`, while the exported `contentDepth` (`contents.ts:298-304`) computes the same value. Use one helper so the drawers task (35) and these functions cannot drift apart.
- **M6: all-flex children with negative space report a fixed-size error and negative sizes** (`layout.ts:642-653`). When `avail < 0` and no child is fixed (for example 20 columns in a 300 mm box), `fixed_sizes_exceed` is raised with no fixed child, and the fallback gives negative child sizes, which reach `ctx.sections` and the divider boxes. This follows the spec text (`rem = avail − 0 < 0`). Make sure Task 37's `section_too_small` covers it and that negative boxes do not break later generators.
- **M7: the report names the wrong task.** It says Task 34 will replace `carcassRun` and must not push sections again. That is Task 36. This affects the report only; the code comments do not name a task.

## Assessment

**Task quality:** Needs fixes. I1 is pending a controller ruling. If the ruling is to keep the spec-literal reading, the task is Approved with Minor items only.

**Reasoning:** Layout, joint discovery, contents and the greedy back split implement the spec exactly, and the mutation-tested suite backs them. The one real gap is the back seam-support test at partition-bounded strips. Within the template ranges, it misplaces seams and raises false warnings on tall wardrobes.
