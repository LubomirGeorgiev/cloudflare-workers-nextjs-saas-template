import type { Editor } from "@tiptap/react"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { toast } from "sonner"
import { reportTiptapError, runTiptapCommand } from "./tiptap-errors"
import { insertTable } from "@/components/tiptap-ui/table-button/use-table"

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
vi.mock("@/lib/tiptap-utils", () => ({ isNodeInSchema: () => true }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("Tiptap error notifications", () => {
  test("shows the error detail and reuses the toast ID for repeated errors", () => {
    const error = new Error("The clipboard is unavailable")
    reportTiptapError({ id: "copy-markdown", message: "Could not copy Markdown", error })
    reportTiptapError({ id: "copy-markdown", message: "Rewritten copy", error })

    expect(toast.error).toHaveBeenNthCalledWith(1, "Could not copy Markdown", {
      id: "tiptap:copy-markdown",
      description: error.message,
    })
    expect(toast.error).toHaveBeenNthCalledWith(2, "Rewritten copy", {
      id: "tiptap:copy-markdown",
      description: error.message,
    })
    expect(console.error).toHaveBeenCalledWith("Could not copy Markdown", error)
  })

  test("omits the description when no error is given", () => {
    reportTiptapError({ id: "copy-markdown", message: "Could not copy Markdown" })

    expect(toast.error).toHaveBeenCalledWith("Could not copy Markdown", {
      id: "tiptap:copy-markdown",
      description: undefined,
    })
  })

  test.each([new Error("Command failed"), "Command failed", null])(
    "shows one toast when a toolbar command throws %s",
    (error) => {
      const editor = {
        isEditable: true,
        commands: { insertTable: () => { throw error } },
      } as unknown as Editor

      expect(insertTable(editor)).toBe(false)
      expect(toast.error).toHaveBeenCalledTimes(1)
      expect(toast.error).toHaveBeenCalledWith("Could not insert the table", expect.any(Object))
    }
  )

  test("shows a toast when a toolbar command rejects the change", () => {
    const editor = {
      isEditable: true,
      commands: { insertTable: () => false },
    } as unknown as Editor

    expect(insertTable(editor)).toBe(false)
    expect(toast.error).toHaveBeenCalledTimes(1)
  })

  test("keeps successful commands and unavailable controls quiet", () => {
    expect(runTiptapCommand({ id: "edit", message: "Could not edit", command: () => true })).toBe(true)
    expect(insertTable(null)).toBe(false)
    expect(insertTable({ isEditable: false } as Editor)).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()
  })
})
