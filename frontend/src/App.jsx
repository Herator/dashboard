import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import WorkoutsPage from "./pages/WorkoutsPage";
import MealPlanPage from "./pages/MealPlanPage";
import GroceryPage from "./pages/GroceryPage";
import ResourcePage from "./components/ResourcePage";
import { RESOURCES } from "./resourceConfigs";
import "./App.css";

const CUSTOM_PAGE_ROUTES = ["workouts", "meal-plan", "groceries"];

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/workouts" element={<WorkoutsPage />} />
        <Route path="/meal-plan" element={<MealPlanPage />} />
        <Route path="/groceries" element={<GroceryPage />} />
        {RESOURCES.filter((resource) => !CUSTOM_PAGE_ROUTES.includes(resource.key)).map((resource) => (
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
