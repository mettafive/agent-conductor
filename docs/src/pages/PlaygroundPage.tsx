import { SectionHead, Page } from "../components/ui";
import { Reveal } from "../components/Reveal";
import { Playground } from "../components/Playground";

export function PlaygroundPage() {
  return (
    <Page>
      <SectionHead
        kicker="Live playground"
        title="Paste a conductor. Watch it become a flow."
        sub="Edit the YAML; the flow graph redraws as you type."
      />
      <Reveal className="mt-12">
        <Playground />
      </Reveal>
    </Page>
  );
}
