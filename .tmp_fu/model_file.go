package model

import "time"

type FileKind string

const (
	FileKindLog        FileKind = "log"
	FileKindAppRelease FileKind = "app-release"
	FileKindFeedback   FileKind = "feedback-image"
)

type UploadResponse struct {
	FileID      string    `json:"file_id"`
	FileKind    FileKind  `json:"file_kind"`
	Platform    string    `json:"platform,omitempty"`
	PackageType string    `json:"package_type,omitempty"`
	Filename    string    `json:"filename"`
	Size        int64     `json:"size"`
	SHA256      string    `json:"sha256"`
	MIMEType    string    `json:"mime_type,omitempty"`
	Width       int       `json:"width,omitempty"`
	Height      int       `json:"height,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	RequestID   string    `json:"request_id,omitempty"`
}
