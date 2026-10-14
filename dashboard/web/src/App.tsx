import { lazy, Suspense, useEffect } from "react";
import { useStore } from "./store/store";
import { AuthGate } from "./components/AuthGate";
import { DevicesPanel } from "./components/DevicesPanel";
import { Toast } from "./components/Toast";
import OperatorView from "./views/OperatorView";

const DesignSpecimen = import.meta.env.DEV
  ? lazy(() => import("./views/DesignSpecimen"))
  : null;

export default function App() {
  const band = useStore((s) => s.band);
  useEffect(() => { document.documentElement.setAttribute("data-band", band); }, [band]);

  if (DesignSpecimen && new URLSearchParams(location.search).has("design")) {
    return (
      <Suspense fallback={null}>
        <DesignSpecimen />
      </Suspense>
    );
  }

  return (
    <AuthGate>
      <OperatorView />
      <DevicesPanel />
      <Toast />
    </AuthGate>
  );
}
