# Templates

Ready-to-use conductors for common workflows. Each one is a complete, valid
conductor — fill in the `inputs` at the top and run it.

| Template | What it does | Shows |
| --- | --- | --- |
| [`blog-post.json`](./blog-post.json) | Research → outline → write → edit → SEO check | Linear flow, every instruction checked |
| [`code-review.json`](./code-review.json) | Read PR → assess security → style → write review | Situational work folded into instructions |
| [`content-page.json`](./content-page.json) | Research → structure → write → validate → SEO | Linear flow with explicit validation instructions |
| [`data-pipeline.json`](./data-pipeline.json) | Extract → validate → transform each table → load → verify | A loop over tables |
| [`price-scraper.json`](./price-scraper.json) | Select targets → scrape each → flag outliers → update DB | A loop over targets |

## Using a template

1. Copy the file (or its contents) to `.conductor/workflow.json`.
2. Fill in the `inputs` at the top.
3. Start the board and hand the conductor to your agent:

   ```bash
   npx conductor-board
   ```

4. Validate any time:

   ```bash
   npx conductor-board validate .conductor/workflow.json
   ```

Every card is checked against its own instruction. Edit instructions so an
independent checker can evaluate the output before running.

## The format

These follow the [conductor spec](../spec/conductor-spec.md). For the full set of
features — loops, output passing, the status file — see the spec and
the [`examples/`](../examples) directory.
