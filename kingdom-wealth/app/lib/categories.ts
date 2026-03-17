export type TransactionType = "expense" | "income" | "transfer" | "refund";

export const CATEGORIES = [
  {
    name: "Giving",
    emoji: "💝",
    color: "#E91E8C",
    description: "Tithes, charity, and gifts",
    subcategories: ["Tithes", "Charity", "Gifts"],
    defaultType: "expense" as TransactionType,
  },
  {
    name: "Saving",
    emoji: "💰",
    color: "#4CAF50",
    description: "Emergency fund, investments, retirement",
    subcategories: ["Emergency Fund", "Sinking Fund", "Investments", "Retirement"],
    defaultType: "transfer" as TransactionType,
  },
  {
    name: "Housing",
    emoji: "🏠",
    color: "#795548",
    description: "Mortgage/rent, repairs, furnishings",
    subcategories: ["Mortgage/Rent", "Property Tax", "HOA", "Repairs", "Furnishings"],
    defaultType: "expense" as TransactionType,
  },
  {
    name: "Food",
    emoji: "🍽️",
    color: "#FF9800",
    description: "Groceries, restaurants, coffee",
    subcategories: ["Groceries", "Restaurants", "Fast Food", "Coffee"],
    defaultType: "expense" as TransactionType,
  },
  {
    name: "Transport",
    emoji: "🚗",
    color: "#2196F3",
    description: "Gas, car payment, insurance, repairs",
    subcategories: ["Gas", "Car Payment", "Car Insurance", "Parking", "Uber/Lyft", "Repairs"],
    defaultType: "expense" as TransactionType,
  },
  {
    name: "Health",
    emoji: "👩‍⚕️",
    color: "#F44336",
    description: "Doctor, dentist, pharmacy, gym",
    subcategories: ["Doctor", "Dentist", "Pharmacy", "Gym", "Vision"],
    defaultType: "expense" as TransactionType,
  },
  {
    name: "Insurance",
    emoji: "🛡️",
    color: "#607D8B",
    description: "Life, health, home insurance",
    subcategories: ["Life Insurance", "Health Insurance", "Home Insurance"],
    defaultType: "expense" as TransactionType,
  },
  {
    name: "Personal",
    emoji: "👤",
    color: "#9C27B0",
    description: "Clothing, subscriptions, education",
    subcategories: ["Clothing", "Haircut", "Subscriptions", "Pet", "Education"],
    defaultType: "expense" as TransactionType,
  },
  {
    name: "Recreation",
    emoji: "🎉",
    color: "#FF5722",
    description: "Entertainment, vacation, hobbies",
    subcategories: ["Entertainment", "Vacation", "Hobbies", "Dining Out"],
    defaultType: "expense" as TransactionType,
  },
  {
    name: "Debt",
    emoji: "💳",
    color: "#F44336",
    description: "Credit cards, loans, medical debt",
    subcategories: ["Credit Card", "Student Loan", "Car Loan", "Personal Loan", "Medical Debt"],
    defaultType: "expense" as TransactionType,
  },
  {
    name: "Income",
    emoji: "💵",
    color: "#4CAF50",
    description: "Salary, freelance, refunds",
    subcategories: ["Salary", "Freelance", "Side Income", "Refund"],
    defaultType: "income" as TransactionType,
  },
] as const;

export const CATEGORY_NAMES = CATEGORIES.map((c) => c.name);

export const getCategoryByName = (name: string) => CATEGORIES.find((c) => c.name === name);

export const getSubcategoriesByParent = (parentName: string) =>
  getCategoryByName(parentName)?.subcategories ?? [];

export const getCategoryEmoji = (name: string) => getCategoryByName(name)?.emoji ?? "📦";

export const getCategoryColor = (name: string) => getCategoryByName(name)?.color ?? "#888888";

export const getDefaultType = (categoryName: string): TransactionType =>
  getCategoryByName(categoryName)?.defaultType ?? "expense";
