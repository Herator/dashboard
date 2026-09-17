import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import WorkoutsPage from "./pages/WorkoutsPage";
import ResourcePage from "./components/ResourcePage";
import { RESOURCES } from "./resourceConfigs";
import "./App.css";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/workouts" element={<WorkoutsPage />} />
        {RESOURCES.filter((resource) => resource.key !== "workouts").map((resource) => (
          <Route
            key={resource.key}
            path={`/${resource.key}`}
            element={
              <ResourcePage
                key={resource.key}
                resourceKey={resource.key}
                label={resource.label}
                fields={resource.fields}
                aiEditable={resource.aiEditable}
                primaryField={resource.primaryField}
              />
            }
          />
        ))}
      </Routes>
    </BrowserRouter>
  );
}
