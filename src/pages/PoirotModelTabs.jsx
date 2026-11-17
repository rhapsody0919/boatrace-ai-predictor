import { MODEL_META } from "./PoirotLogic";

export default function PoirotModelTabs({ modelVersion, onSelect }) {
  return (
    <div className="poirot-model-tabs" role="tablist">
      {Object.entries(MODEL_META).map(([version, m]) => (
        <button
          key={version}
          role="tab"
          aria-selected={modelVersion === version}
          className={
            "poirot-model-tab" + (modelVersion === version ? " is-active" : "")
          }
          onClick={() => onSelect(version)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
