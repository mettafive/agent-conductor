# Templates

Ready-to-use conductors for common workflows. Each one is a complete, valid
conductor — fill in the `inputs` at the top and run it.

| Template | What it does | Shows |
| --- | --- | --- |
| [`blog-post.yaml`](./blog-post.yaml) | Research → outline → write → edit → SEO check | Linear flow, soft + hard gates |
| [`code-review.yaml`](./code-review.yaml) | Read PR → (security?) → style → write review | A condition that branches and rejoins |
| [`content-page.yaml`](./content-page.yaml) | Research → structure → write → validate → SEO | Linear flow with an HTML validation gate |
| [`data-pipeline.yaml`](./data-pipeline.yaml) | Extract → validate → transform each table → load → verify | A loop over tables |
| [`price-scraper.yaml`](./price-scraper.yaml) | Select targets → scrape each → flag outliers → update DB | A loop over targets |

## Using a template

1. Copy the file (or its contents) to `.conductor/conductor.yaml`.
2. Fill in the `inputs` at the top.
3. Start the board and hand the conductor to your agent:

   ```bash
   npx conductor-board
   ```

4. Validate any time:

   ```bash
   npx conductor-board validate .conductor/conductor.yaml
   ```

Every gate is plain language (soft) or a shell command that must exit `0` (hard).
Edit them to match your project — tighten a gate, add a `check:`, or split a step.

## The format

These follow the [conductor spec](../spec/conductor-spec.md). For the full set of
features — conditions, loops, output passing, the status file — see the spec and
the [`examples/`](../examples) directory.
