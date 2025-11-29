"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { suggestTopics, generateContent, type Topic } from "@/lib/blog-api"
import { useRouter } from "next/navigation"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface GeneratePostDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function GeneratePostDialog({ open, onOpenChange, onSuccess }: GeneratePostDialogProps) {
  const router = useRouter()
  const [step, setStep] = useState<"input" | "topics" | "generating">("input")
  const [loading, setLoading] = useState(false)
  const [brandPersonaId, setBrandPersonaId] = useState("")
  const [topicCount, setTopicCount] = useState(10)
  const [topics, setTopics] = useState<Topic[]>([])
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null)
  const [wordCount, setWordCount] = useState(1000)

  const handleGenerateTopics = async () => {
    if (!brandPersonaId.trim()) {
      toast.error("Please enter a brand persona ID")
      return
    }

    try {
      setLoading(true)
      const response = await suggestTopics(brandPersonaId, topicCount)
      setTopics(response.topics)
      setStep("topics")
      toast.success(`Generated ${response.topics.length} topics`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to generate topics")
    } finally {
      setLoading(false)
    }
  }

  const handleGenerateContent = async () => {
    if (!selectedTopicId) {
      toast.error("Please select a topic")
      return
    }

    try {
      setLoading(true)
      setStep("generating")
      const post = await generateContent(selectedTopicId, wordCount)
      toast.success("Post generated successfully!")
      onOpenChange(false)
      resetDialog()
      if (onSuccess) {
        onSuccess()
      } else {
        router.push(`/dashboard/blog-posts/${post.id}/edit`)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to generate content")
      setStep("topics")
    } finally {
      setLoading(false)
    }
  }

  const resetDialog = () => {
    setStep("input")
    setBrandPersonaId("")
    setTopicCount(10)
    setTopics([])
    setSelectedTopicId(null)
    setWordCount(1000)
  }

  return (
    <Dialog open={open} onOpenChange={(open) => {
      onOpenChange(open)
      if (!open) {
        resetDialog()
      }
    }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Generate Blog Post with AI
          </DialogTitle>
          <DialogDescription>
            Use AI to generate blog topics and content based on your brand persona
          </DialogDescription>
        </DialogHeader>

        {step === "input" && (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="brandPersonaId">Brand Persona ID *</Label>
              <Input
                id="brandPersonaId"
                value={brandPersonaId}
                onChange={(e) => setBrandPersonaId(e.target.value)}
                placeholder="Enter brand persona UUID"
                required
              />
              <p className="text-xs text-muted-foreground">
                The brand persona ID to generate topics for
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="topicCount">Number of Topics</Label>
              <Input
                id="topicCount"
                type="number"
                min={1}
                max={50}
                value={topicCount}
                onChange={(e) => setTopicCount(parseInt(e.target.value) || 10)}
              />
              <p className="text-xs text-muted-foreground">
                Number of topics to generate (1-50, default: 10)
              </p>
            </div>
          </div>
        )}

        {step === "topics" && (
          <div className="space-y-4 py-4">
            <div className="rounded-lg border bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground mb-1">Brand Persona ID</p>
              <p className="text-sm font-mono">{brandPersonaId}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="wordCount">Word Count</Label>
              <Input
                id="wordCount"
                type="number"
                min={500}
                max={5000}
                value={wordCount}
                onChange={(e) => setWordCount(parseInt(e.target.value) || 1000)}
              />
              <p className="text-xs text-muted-foreground">
                Target word count for the generated post (500-5000, default: 1000)
              </p>
            </div>
            <div>
              <Label>Select a Topic</Label>
              <div className="grid gap-2 mt-2 max-h-[400px] overflow-y-auto">
                {topics.map((topic) => (
                  <Card
                    key={topic.id}
                    className={`cursor-pointer transition-colors ${
                      selectedTopicId === topic.id
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                    onClick={() => setSelectedTopicId(topic.id)}
                  >
                    <CardHeader>
                      <CardTitle className="text-base">{topic.title}</CardTitle>
                      <CardDescription>{topic.category}</CardDescription>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === "generating" && (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground mb-4">
              Generating your blog post with AI... This may take 30-60 seconds.
            </p>
            <div className="rounded-lg border bg-muted/50 p-3 w-full max-w-md">
              <p className="text-xs text-muted-foreground mb-1">Brand Persona ID</p>
              <p className="text-sm font-mono">{brandPersonaId}</p>
            </div>
          </div>
        )}

        <DialogFooter>
          {step === "input" && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button onClick={handleGenerateTopics} disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Generate Topics
              </Button>
            </>
          )}
          {step === "topics" && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep("input")}
                disabled={loading}
              >
                Back
              </Button>
              <Button
                onClick={handleGenerateContent}
                disabled={loading || !selectedTopicId}
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Generate Content
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

