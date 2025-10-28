"use server";

export type DefineCmsCollection = {
  slug: string;
  labels: {
    singular: string;
    plural: string;
  };
  fields?: Record<string, unknown>;
};

export type DefineCmsConfig = {
  collections: Record<string, DefineCmsCollection>;
};
