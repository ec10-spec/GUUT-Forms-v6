// The sample form shown on the landing page and at #/example. Nothing is ever sent from it.
export const SAMPLE_FORM = {
  _id: "example",
  title: "Coffee shop feedback",
  description: "Two minutes, five questions. Tell us how your visit went.",
  theme: { primaryColor: "#001549", backgroundColor: "#f6f7fb", headerImage: null },
  fields: [
    { id: "visit", type: "select", label: "How often do you visit?", options: ["First time", "Weekly", "Most days"], required: true, order: 0, placeholder: "" },
    { id: "rating", type: "rating", label: "How was your coffee today?", options: [], required: true, order: 1, placeholder: "" },
    { id: "improve", type: "textarea", label: "What should we improve?", options: [], required: false, order: 2, placeholder: "Anything at all", showIf: { fieldId: "rating", op: "lte", values: ["3"], equals: "3" } },
    { id: "extras", type: "checkbox", label: "What else would you order?", options: ["Pastries", "Sandwiches", "Oat milk", "Decaf"], required: false, order: 3, placeholder: "" },
    { id: "email", type: "email", label: "Email for a free coffee (optional)", options: [], required: false, order: 4, placeholder: "you@example.com" },
  ],
};
