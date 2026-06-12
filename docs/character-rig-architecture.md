# Character Rig Architecture: Angles, Bones, Joints, Sockets, and Variants

This is the canonical vocabulary and structural model for Studio Boom characters. The
implementation details (HTML document model, JSON artifacts, motion contract) live in
[character-json-rig-motion-architecture.md](./character-json-rig-motion-architecture.md);
this document defines what the pieces *mean* and who owns what.

The main goal is to make the character editor support clean 2.5D character setup, especially
for characters with multiple view angles and body-part variations.

The editor should be simple for the user, but the underlying architecture needs to be flexible
enough for real animation needs. A non-animator should be able to choose a character angle,
choose body-part variants from dropdowns, and get a clean result without manually managing
bones, sockets, pivots, masks, or layer order.

The key architectural idea is:

**The slot stays stable. The angle owns the drawing and skeleton. The bone owns the
joint/socket. The variant can override how that body part behaves.**

## 1. Angle

An **angle** means a full view of the character, such as front, side, three-quarter, back.

Each angle is its own drawing space. Front view and side view are not the same drawing. They
may share the same character identity and the same slot names, but the actual artwork,
skeleton positions, bone positions, and socket positions can be different.

For example, the front-view right arm and the side-view right arm may both belong to the
`rightArm` slot, but they are not forced to share the same artwork or the same bone layout.

```text
Character
  Angle: Front
    Front artwork
    Front skeleton
    Front sockets/joints

  Angle: Side Left
    Side-left artwork
    Side-left skeleton
    Side-left sockets/joints
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

## 3. Bone

A **bone** is the animatable structure inside a slot — the thing that moves or rotates.

Bones belong to the skeleton **of a specific angle**. A front-view skeleton and a side-view
skeleton can place the same bone differently:

```text
Front angle: rightHand pivot here
Side angle:  rightHand pivot somewhere else
```

The bone *identity* stays consistent (`forearm` still means forearm), but its location can
change by angle and by variant.

## 4. Joint

A **joint** is the meaningful connection point between body parts: shoulder, elbow, wrist,
neck, hip, knee, ankle. The wrist is where the hand attaches to the arm; the shoulder is
where the arm attaches to the body.

**Joints belong to bones/skeletons. They do not belong to artwork packages.** A joint is rig
logic, not part of a single image.

## 5. Socket

A **socket** is the authored attachment point at a joint: "this child part attaches here."

```text
The right hand attaches to the right arm at the wrist socket.
The right arm attaches to the body at the shoulder socket.
```

**Sockets belong to the parent bone/joint, not to a variant package.** The socket defines the
joint relationship; variants may then override where that socket sits for a specific drawing.

```text
Angle
  Skeleton
    Bone
      Socket / joint
        rest position
        variant-specific anchor overrides
```

## 6. Rest Position vs Variant Override

Every joint/socket has a normal **rest position** — the default location of the joint in that
angle's skeleton (in Studio Boom, the child bone's base position, which is directly editable
with the Bones overlay).

A **variant override** moves the joint for a specific variant:

```text
Right arm relaxed:      wrist sits low beside the dress.
Right arm bent:         wrist sits higher near the chest.
Right arm outstretched: wrist sits far out to the side.
```

The socket belongs to the bone; the variant says "for this drawing, the wrist is *here*."

## 7. Variant

A **variant** is not just a pose name — it is an open-ended body-part configuration:
relaxed arm, bent-elbow arm, outstretched arm, waving arm, hand-on-hip arm, holding-book arm…
The system is not hardcoded around any list; internally a variant is a stable ID with
metadata, and the user sees a friendly label.

**A variant is a rigged mini-asset, not just an image swap.** A variant may carry:

```text
artwork layers
bone/pivot positions
movement limits
socket/joint overrides
clipping masks
z-order rules
controls
AI-readable metadata
compatibility rules
```

A relaxed arm and a bent-elbow arm may have different elbow positions, wrist positions,
clipping needs, rotation limits, and layer ordering — they are not forced into one universal
layout.

## 8. Variant Metadata

Every variant should be understandable by the editor *and* by AI without guessing from
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

## 12. Clipping and Masks *(roadmap)*

Some variants need their own clipping: a bent elbow tucks the forearm under the sleeve; a
relaxed arm hides the elbow overlap on the inner side. Clipping/masks belong to the specific
variant, not globally to the character.

## 13. Z-Order / Layer Order *(roadmap)*

Layer order may be variant-specific (a bent forearm renders in front of the body; a relaxed
one partly behind the dress). The selected variant brings the correct layer rules with it —
the user never fixes stacking by hand.

## 14. Controls *(roadmap)*

Variants may define their own animation controls (elbow bend, wrist tilt, wave amount,
hand open/close). The editor shows only the controls that make sense for the active variant.

## 15. Compatibility *(roadmap)*

Variants need compatibility rules: angle compatibility (a side-view hand never attaches to a
front-view arm), slot compatibility, hand/arm pairing, object sockets. These keep users from
combining parts that cannot work together.

## 16. AI-Readable Architecture *(roadmap: enrichment)*

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

## 18. The Clean Final Model

```text
Character
  Angles
    Artwork for that angle
    Skeleton for that angle
      Bones
        Joints / sockets
          Rest position
          Variant-specific overrides

  Slots
    Stable body-part containers

  Variants
    Open-ended body-part configurations
    May include artwork, rig overrides, clipping, z-order, controls, compatibility, AI metadata

  Poses
    Saved combinations of slot variants

  Derived anchors
    Resolved output consumed by animation/composition systems
```

## 19. Simple Version

An **angle** is the view of the character.
A **slot** is the body-part container.
A **bone** is the animatable structure.
A **joint** is where body parts connect or bend.
A **socket** is the attachment point at that joint.
A **variant** is a flexible body-part option that may bring its own artwork, rig behavior,
clipping, controls, and metadata.
A **pose** is a combination of variants across the whole character.

Sockets belong to bones/joints, not to variant packages. Variants can override sockets, but
they do not own the concept of the socket. Angles own their own drawings and skeletons. The
editor is never locked into a fixed list of pose names. The system allows open-ended future
variants with clear metadata.

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
