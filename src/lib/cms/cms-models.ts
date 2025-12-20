export type DefineCmsCollection = {
  slug: string;
  labels: {
    singular: string;
    plural: string;
  };
  fields?: Record<string, unknown>;
  previewUrl?: string;
};

export type DefineCmsConfig = {
  collections: Record<string, DefineCmsCollection>;
};
