# Skill: image-classification

**Intent:** Assign each image a valid class with confidence; class is one the model supports.

**Grounding source (truth the work is checked against):** the image + the allowed class set

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Load the images + the allowed class taxonomy into the grounding bundle.
2. For each image in the list:
   a. Classify <image>.
3. Confirm every image classified with a valid class+confidence.
