# Character Rig Architecture: Angles, Bones, Joints, Sockets, and Variants

This is the canonical vocabulary and structural model for Studio Boom characters. The
implementation details (HTML document model, JSON artifacts, motion contract) live in
[character-json-rig-motion-architecture.md](./character-json-rig-motion-architecture.md);
this document defines what the pieces _mean_ and who owns what.

The main goal is to make the character editor support clean 2.5D character setup, especially
for characters with multiple view angles and body-part variations.

The editor should be simple for the user, but the underlying architecture needs to be flexible
enough for real animation needs. A non-animator should be able to choose a character angle,
choose body-part variants from dropdowns, and get a clean result without manually managing
bones, sockets, pivots, masks, or layer order.

The key architectural idea is:

**The slot stays stable. The angle owns the drawing and skeleton. The bone owns the
conceptual joint. The socket is the stored attachment data. The variant can override how
that body part behaves.**

## 1. Angle

An **angle** means a full view of the character, such as front, side, three-quarter, back.

Each angle is its own drawing space. Front view and side view are not the same drawing. They
may share the same character identity and the same slot names, but the actual artwork,
skeleton positions, bone positions, and socket positions can be different.

`character.angles` is the canonical list of angles that exist for a character.
`rig.angles` stores per-angle rig data for those angles. `part.angleIds` says which
angles a specific artwork asset belongs to. Do not treat `rig.angles` keys or
`part.angleIds` as creating character angles by themselves; they are subordinate to
`character.angles`. Legacy saves may have parts without `angleIds`; new authoring
should make angle membership explicit and reserve "shared across angles" for a
visible opt-in.

For example, the front-view right arm and the side-view right arm may both belong to the
`rightArm` slot, but they are not forced to share the same artwork or the same bone layout.

```text
Character
  Angle: Front
    Front artwork
    Front skeleton
    Front sockets

  Angle: Side Left
    Side-left artwork
    Side-left skeleton
    Side-left sockets
```

This prevents front artwork and side artwork from stacking on top of each other. It also
prevents a wrist socket authored for the front view from incorrectly affecting the
side-view hand.

## 2. Slot

A **slot** is the stable body-part container: `head`, `body`, `rightArm`, `leftHand`,
`hair`, `mouth`, `eyes`, …

Slots give the character a consistent structure across angles and variants. The slot itself
is not one fixed drawing — it is a named place in the character system where artwork and rig
data attach:

```text
Slot: rightArm
  Front angle: front right-arm drawing(s)
  Side angle:  side right-arm drawing(s)
  Variants:    relaxed, bent, raised, holding object, …
```

The user sees the slot as something simple — `Right Arm: [choose variant]` — but internally
the slot loads different artwork, rig settings, sockets, masks, and metadata depending on the
active angle and selected variant.

In the current persisted model, a slot is mostly derived from `part.slotId`; there is no
durable standalone slot record yet. That is acceptable for simple authoring, but tools should
still behave as though slots are first-class semantic objects. If slots gain their own
metadata later (role, label, compatibility, AI hints), that metadata should live on a real slot
record and `part.slotId` should become a reference to it, not the only source of slot identity.

## 3. Bone

A **bone** is the animatable structure inside a slot — the thing that moves or rotates.

Bones belong to the skeleton **of a specific angle**. A front-view skeleton and a side-view
skeleton can place the same bone differently:

```text
Front angle: rightHand pivot here
Side angle:  rightHand pivot somewhere else
```

The bone _identity_ stays consistent (`forearm` still means forearm), but its location can
change by angle and by variant.

## 4. Joint

A **joint** is the meaningful connection point between body parts: shoulder, elbow, wrist,
neck, hip, knee, ankle. The wrist is where the hand attaches to the arm; the shoulder is
where the arm attaches to the body.

**Joints belong to bones/skeletons. They do not belong to artwork packages.** A joint is rig
logic, not part of a single image.

There is no separate `Joint` data structure in the current code. "Joint" is vocabulary for
the user and for rig reasoning. The stored authoring primitive is the socket.

## 5. Socket

A **socket** is the authored attachment point at a joint: "this child part attaches here."

```text
The right hand attaches to the right arm at the wrist socket.
The right arm attaches to the body at the shoulder socket.
```

**Sockets belong to the parent bone/joint, not to a variant package.** In data, the socket is
the concrete record for that joint relationship. Variants may then override where that socket
sits for a specific drawing.

```text
Angle
  Skeleton
    Bone
      Socket
        conceptual joint label
        rest position (x/y/rotation in this angle's canvas)
        variant-specific anchor overrides
```

## 6. Rest Position vs Variant Override

Every socket has a normal **rest position** — the default location of the conceptual joint in
that angle's skeleton. In persisted data this is the socket's `x`, `y`, and optional
`rotation`; the child bone's base transform is derived from that socket.

A **variant override** moves the joint for a specific variant:

```text
Right arm relaxed:      wrist sits low beside the dress.
Right arm bent:         wrist sits higher near the chest.
Right arm outstretched: wrist sits far out to the side.
```

The socket belongs to the bone; the variant says "for this drawing, the wrist is _here_."

Implementation status: this is the runtime/editor contract. Attachment authoring writes the
angle-local slot relation and base socket together. Variant overrides only move that socket for
specific parent variants; clearing an override returns to the base socket instead of deleting the
joint relationship.

## 7. Variant

A **variant** is not just a pose name. It is the selected semantic option for a slot:
relaxed arm, bent-elbow arm, outstretched arm, waving arm, hand-on-hip arm, holding-book
arm, open hand, fist, smile, blink, and so on. The system is not hardcoded around any
fixed pose list; internally a variant has a stable key/id with metadata, and the user sees a
friendly label.

A durable distinction matters:

```text
Semantic variant
  "right arm = bent"
  stable across angles; used by poses, AI, dropdowns, and Action/Expression JSON

Angle-specific variant asset
  "3qR right arm art that implements bent"
  concrete artwork and rig overrides for one angle
```

Today, a variant can carry or reference:

```text
artwork layers
socket anchor overrides
movement limits / reaches
AI-readable metadata
```

The angle skeleton still owns the bones and rest pivots. A variant can override where a child
attaches under that skeleton, but it should not become a second skeleton hidden inside an
artwork package.

Future variants may also carry clipping, variant-specific z-order rules, controls, and richer
compatibility rules. Those are roadmap capabilities unless a section below says otherwise.

## 8. Variant Metadata

Every variant should be understandable by the editor _and_ by AI without guessing from
filenames:

```json
{
  "variantId": "variant_023",
  "displayName": "Bent elbow, explaining",
  "slotId": "rightArm",
  "plainDescription": "The right arm is raised with the elbow bent. The hand is near chest height. Useful for explaining or talking.",
  "tags": ["right_arm", "bent", "raised", "explaining", "talking", "friendly"],
  "goodFor": ["explaining", "presenting", "talking"],
  "lessIdealFor": ["running", "sleeping", "resting"],
  "handPosition": { "relativeToBody": "chest_height", "reachDirection": "inward" }
}
```

If the user says "make her look like she's explaining something," the AI should find the best
variant from metadata.

## 9. Pose

A **pose** is the current combination of selected variants across slots:

```text
Pose: explaining
  rightArm  = bent elbow variant
  rightHand = open hand variant
  leftArm   = relaxed variant
```

```text
Variant = one body part option.
Pose    = full character configuration.
```

Pose presets should reference semantic slot variant keys, not concrete part IDs. The active
angle resolves those semantic keys to its own angle-specific artwork and socket overrides.

Poses have no timing. Timed character changes are separate:

```text
Pose
  held body/variant state; no keyframes

Action
  repeatable body animation; can be scoped to full body, upper body, lower body,
  hands, head, or another region

Expression
  timed facial animation; overrides facial movement from Actions

Speech / lip sync
  placed audio plus viseme timing; separate from Actions and Expressions
```

Stage motion is different again: it moves the entire character clip around the scene and
does not change the character rig.

## 10. Pose Preset

A **pose preset** is a saved combination of variants — a convenience layer for the user, not
a structural tier:

```json
{
  "posePresetId": "pose_explaining_001",
  "displayName": "Explaining",
  "slots": { "rightArm": "variant_023", "rightHand": "variant_011", "leftArm": "variant_004" }
}
```

The editor may offer presets (standing, explaining, waving, …) but the system never depends
on a fixed list of pose names.

## 11. Artwork Layers

Each angle owns its own artwork. A front-view arm drawing does not automatically appear in
the side view. When a new angle is created it starts empty unless the user deliberately marks
a part as **Shared** (props, accessories). Front and side drawings are genuinely different in
character animation; sharing is intentional, never the default.

## 12. Clipping and Masks _(roadmap)_

Some variants need their own clipping: a bent elbow tucks the forearm under the sleeve; a
relaxed arm hides the elbow overlap on the inner side. Clipping/masks belong to the specific
variant, not globally to the character.

## 13. Z-Order / Layer Order _(roadmap)_

Each angle needs a minimum draw order today so front, 3qR, and side views can stack their own
parts differently without borrowing another angle's order. Variant-specific layer order is a
roadmap extension: a bent forearm may render in front of the body, while a relaxed one may sit
partly behind the dress. When that exists, the selected variant should bring the correct layer
rules with it so the user does not fix stacking by hand.

## 14. Controls _(roadmap)_

Variants may define their own animation controls (elbow bend, wrist tilt, wave amount,
hand open/close). The editor shows only the controls that make sense for the active variant.

## 15. Compatibility _(roadmap)_

Variants need compatibility rules: angle compatibility (a side-view hand never attaches to a
front-view arm), slot compatibility, hand/arm pairing, object sockets. These keep users from
combining parts that cannot work together.

The minimum compatibility rule exists now: a concrete part, socket, parent, or host selected
inside an angle must resolve inside that same angle unless the user deliberately marked it as
shared. Cross-angle fallback is a bug, not a convenience.

## 16. AI-Readable Architecture _(roadmap: enrichment)_

The AI should understand the character from explicit metadata — body part, side, angle,
gesture, pose use, hand position, energy, goodFor/lessIdealFor, tags, plainDescription —
never from filenames.

## 17. Derived Anchor Layer

The authored source of sockets lives in bone-owned, per-angle rig records; the **derived
anchor layer stays stable**. Composition, motion, recorder, preview, and rig health all
consume the same resolved anchors regardless of where authoring happens:

```text
Change where sockets are authored.
Do not break the systems that consume resolved anchors.
```

The derived anchor layer is the boundary between authoring data and runtime behavior. Editors
may move pivots, switch variants, edit sockets, import JSON, or migrate legacy records, but
rendering and motion systems should consume only resolved anchors.

Allowed consumers of resolved anchors:

```text
character composition builder
motion preview and recorder
pose/variant preview
rig health/checklist
AI context export
```

Those systems should call the shared resolution path instead of reading raw sockets or
variant-package data directly.

Resolution contract:

```text
active character angle
  -> angle rig skeleton
  -> parent slot / child slot relation
  -> child rest position
  -> selected semantic parent variant key
  -> authored socket override for that key, if any
  -> paired angle-specific child art for that key, if any
  -> representative/rest fallback with a warning
```

Coordinate spaces must stay explicit:

```text
canvas space
  user-facing points on the character canvas

parent-bone local space
  resolved anchor offset consumed by skeleton/motion

part local space
  artwork pivot/alpha bounds inside one image asset
```

Current socket records store authored anchor points in angle canvas pixels, then the rig build
derives parent-bone-local anchors from them. If that storage changes later, the derived
parent-bone-local contract should not change.

Invalidation trigger:

```text
any change to character.angles
any change to part.angleIds, slotId, variant key, pivot, transform, or visibility
any change to rig.angles[angle] bones, slot relations, sockets, reaches, hosts, or draw order
any pose or active angle change used for preview
```

After any of those changes, rebuild or re-read the derived anchors before previewing,
exporting, checking rig health, or emitting AI context.

## 18. The Clean Final Model

```text
Character
  Angles
    Artwork for that angle
    Skeleton for that angle
      Bones
        Joints (conceptual)
        Sockets (stored data primitive)
          Rest position
          Variant-specific overrides

  Slots
    Stable body-part containers
    Currently derived from part.slotId; future slot records may own metadata

  Variants
    Semantic variant keys shared across angles
    Angle-specific assets implement those keys with artwork and socket/reach overrides
    Roadmap: clipping, variant z-order, controls, compatibility

  Poses
    Saved combinations of semantic slot variants

  Derived anchors
    Resolved output consumed by animation/composition systems
```

## 19. Simple Version

An **angle** is the view of the character.
A **slot** is the body-part container.
A **bone** is the animatable structure.
A **joint** is where body parts connect or bend; it is conceptual vocabulary, not a current
data record.
A **socket** is the stored attachment point at that joint.
A **variant** is a semantic body-part option. Each angle can have its own artwork asset for
that same option.
A **pose** is a combination of variants across the whole character.

Sockets belong to bones/joints, not to variant packages. Variants can override socket anchors,
but they do not own the socket concept or the angle skeleton. `character.angles` is the
canonical list of available angles. Angles own their own drawings and skeletons. The editor is
never locked into a fixed list of pose names. The system allows open-ended future variants with
clear metadata.

## 20. Why This Matters

This architecture avoids:

```text
sockets living in variant packages
phantom packages
front sockets affecting side drawings
all angle artwork stacking together
variants treated too narrowly
AI unable to understand what body parts mean
```

and gives us:

```text
clean angle separation
clean socket ownership
clean body-part variation
future AI-readable posing
better animation support
less manual fixing for users
```

The key principle:

**Keep the user-facing editor simple, but make each body-part variant powerful enough to
carry the rigging information it needs.**
