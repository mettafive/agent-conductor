# Skill: deploy-pipeline

**Intent:** Ship the build to prod only if health checks pass and rollback is proven.

**Grounding source (truth the work is checked against):** the live health endpoint + the prior known-good version

**Shape:** single pass.

## Procedure
1. Record the current prod version + a passing health snapshot into the grounding bundle.
2. Deploy the new build and verify health.
