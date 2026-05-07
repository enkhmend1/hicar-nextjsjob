export interface CarInfo {
  name: string;
  detail: string;
}

export interface Product {
  id: string;
  name: string;
  oem: string;
  price: number;
  src: string;
  icon: "disc" | "engine" | "light" | "gear" | "sensor" | "filter";
}

export interface Category {
  id: string;
  name: string;
  count: string;
  icon: "engine" | "brake" | "light" | "cooling" | "electric" | "body" | "tire" | "transmission";
}
