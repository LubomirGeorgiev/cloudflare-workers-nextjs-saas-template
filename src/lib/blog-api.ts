/**
 * Blog Service API Client
 * Handles all API calls to the blog service
 */

const BLOG_API_BASE_URL = "https://blogservice-production.ali-75a.workers.dev";

export interface BlogPost {
  id: string;
  title: string;
  content: string;
  status: "draft" | "published";
  featuredImageUrl?: string;
  featuredImageId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedPosts {
  results: BlogPost[];
  page: number;
  limit: number;
  totalPages: number;
  totalResults: number;
}

export interface CreatePostData {
  title: string;
  content: string;
  status?: "draft" | "published";
  featuredImageId?: string;
}

export interface UpdatePostData {
  title?: string;
  content?: string;
  status?: "draft" | "published";
  featuredImageId?: string;
}

export interface Topic {
  id: string;
  title: string;
  category: string;
  brandPersonaId: string;
  generationId: string;
  createdAt: string;
}

export interface SuggestTopicsResponse {
  success: boolean;
  count: number;
  generationId: string;
  brandPersonaId: string;
  topics: Topic[];
}

export interface GenerateContentResponse extends BlogPost {
  topicId: string;
  category: string;
  wordCount: number;
  generatedAt: string;
}

class BlogApiError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "BlogApiError";
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === "object" && "message" in error 
      ? String(error.message) 
      : response.statusText;
    throw new BlogApiError(response.status, errorMessage || "An error occurred");
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

/**
 * Get all blog posts with pagination and filtering
 */
export async function getPosts(params?: {
  page?: number;
  limit?: number;
  sortBy?: string;
  title?: string;
  status?: "draft" | "published";
}): Promise<PaginatedPosts> {
  const searchParams = new URLSearchParams();
  
  if (params?.page) searchParams.append("page", params.page.toString());
  if (params?.limit) searchParams.append("limit", params.limit.toString());
  if (params?.sortBy) searchParams.append("sortBy", params.sortBy);
  if (params?.title) searchParams.append("title", params.title);
  if (params?.status) searchParams.append("status", params.status);

  const url = `${BLOG_API_BASE_URL}/posts${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
  const response = await fetch(url);
  return handleResponse<PaginatedPosts>(response);
}

/**
 * Get a single blog post by ID
 */
export async function getPost(id: string): Promise<BlogPost> {
  const response = await fetch(`${BLOG_API_BASE_URL}/posts/${id}`);
  return handleResponse<BlogPost>(response);
}

/**
 * Create a new blog post
 */
export async function createPost(data: CreatePostData): Promise<BlogPost> {
  const response = await fetch(`${BLOG_API_BASE_URL}/posts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  return handleResponse<BlogPost>(response);
}

/**
 * Update an existing blog post
 */
export async function updatePost(id: string, data: UpdatePostData): Promise<BlogPost> {
  const response = await fetch(`${BLOG_API_BASE_URL}/posts/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  return handleResponse<BlogPost>(response);
}

/**
 * Delete a blog post
 */
export async function deletePost(id: string): Promise<void> {
  const response = await fetch(`${BLOG_API_BASE_URL}/posts/${id}`, {
    method: "DELETE",
  });
  await handleResponse<void>(response);
}

/**
 * Publish a blog post
 */
export async function publishPost(id: string): Promise<{ success: boolean; message: string; postId: string }> {
  const response = await fetch(`${BLOG_API_BASE_URL}/posts/${id}/publish`, {
    method: "PATCH",
  });
  return handleResponse<{ success: boolean; message: string; postId: string }>(response);
}

/**
 * Suggest topics using AI
 */
export async function suggestTopics(
  brandPersonaId: string,
  count: number = 10
): Promise<SuggestTopicsResponse> {
  const searchParams = new URLSearchParams({
    brandPersonaId,
    count: count.toString(),
  });
  const response = await fetch(`${BLOG_API_BASE_URL}/post/suggest-topics?${searchParams.toString()}`);
  return handleResponse<SuggestTopicsResponse>(response);
}

/**
 * Generate blog content using AI
 */
export async function generateContent(
  topicId: string,
  wordCount: number = 1000
): Promise<GenerateContentResponse> {
  const searchParams = new URLSearchParams({
    topicId,
    wordCount: wordCount.toString(),
  });
  const response = await fetch(`${BLOG_API_BASE_URL}/post/generate-content?${searchParams.toString()}`);
  return handleResponse<GenerateContentResponse>(response);
}

/**
 * Get image URL from the blog service
 */
export function getImageUrl(key: string): string {
  return `${BLOG_API_BASE_URL}/images/${key}`;
}

export { BlogApiError };

