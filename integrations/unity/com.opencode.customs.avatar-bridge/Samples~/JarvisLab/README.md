# Jarvis Lab vertical slice

After importing this sample, choose **OpenCode Customs → Create Jarvis Lab Scene**. The builder creates `Assets/JarvisLab/JarvisLab.unity` with a baked NavMesh, companion, semantic sensor, developer overlay, scenario recorder, door, portable items, crafting ingredients, technician NPC, quest state, save-slot persistence, and a critical training target.

Paste the PCVR pairing JSON from **OpenCode Customs → Settings → Avatar & VR** into `Jarvis Companion > OpenCodeAvatarBridgeV2.connectionJson`, then enter Play mode.

Suggested acceptance goal:

1. Find and pick up `lab_key`.
2. Open `lab_door`.
3. Pick up `casing` and `energy_core`.
4. Craft `power_cell`.
5. Give `power_cell` to `technician`.
6. Confirm that the quest is complete, restart Play mode, and verify save-slot memory.

`training.attack` uses permission category `combat.training`. It requires approval until that exact category is added to the trusted profile for `jarvis-lab` in OpenCode Customs. The scene never exposes arbitrary Unity methods.
