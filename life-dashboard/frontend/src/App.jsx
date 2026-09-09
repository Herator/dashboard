import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import ResourcePage from "./components/ResourcePage";
import { RESOURCES } from "./resourceConfigs";
import "./App.css";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        {RESOURCES.map((resource) => (
          <Route
            key={resource.key}
            path={`/${resource.key}`}
            element={<ResourcePage resourceKey={resource.key} label={resource.label} fields={resource.fields} />}
          />
        ))}
      </Routes>
    </BrowserRouter>
  );
}
