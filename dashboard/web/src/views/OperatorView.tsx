import { Header } from "../components/Header";
import { DegradedBanner } from "../components/DegradedBanner";
import { RiskPanel } from "../components/RiskPanel";
import { HardwareTwin } from "../components/HardwareTwin";
import { PipelineStrip } from "../components/PipelineStrip";
import { IndicatorTwin } from "../components/IndicatorTwin";
import { NodeTiles } from "../components/NodeTiles";
import { History } from "../components/History";
import { AlertFeed } from "../components/AlertFeed";
import { EventFeed } from "../components/EventFeed";
import { DetectionLayers } from "../components/DetectionLayers";
import { CommandConsole } from "../components/CommandConsole";
import { QuickControls } from "../components/QuickControls";
import { IoTGraph } from "../components/IoTGraph";
import { StatusStrip } from "../components/StatusStrip";
import { Footer } from "../components/Footer";

export default function OperatorView() {
  return (
    <div className="ops-layout">
      <Header />
      <DegradedBanner />
      <main className="ops-grid">
        <section className="panel ops-scoring">
          <span className="label">Risk</span>
          <RiskPanel />
          <History compact />
          <PipelineStrip />
          <IndicatorTwin />
        </section>

        <section className="panel ops-console">
          <span className="label">Console</span>
          <CommandConsole />
        </section>

        <section className="panel ops-devmap">
          <span className="label">Hardware</span>
          <HardwareTwin />
          <NodeTiles compact />
          <DetectionLayers />
        </section>

        <section className="panel ops-events">
          <span className="label">Alerts &amp; events</span>
          <AlertFeed />
          <EventFeed />
        </section>

        <section className="panel ops-controls">
          <span className="label">Controls</span>
          <QuickControls />
        </section>

        <section className="panel ops-iot">
          <span className="label">IoT Topology</span>
          <IoTGraph />
        </section>
      </main>
      <StatusStrip />
      <Footer />
    </div>
  );
}
