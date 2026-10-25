export type HomeCascadeOption = { id: string; label: string };

export type HomeCascadeLevel = {
  key: string;
  label: string;
  value: string | null;
  options: HomeCascadeOption[];
  allLabel?: string;
  pendingLabel?: string;
};
