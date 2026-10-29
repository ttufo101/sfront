package auth

import "errors"

var (
	ErrTokenInvalid = errors.New("access token is invalid")
	ErrTokenExpired = errors.New("access token is expired")
)

type Principal struct {
	UserID string
}

type Verifier interface {
	Verify(rawToken string) (Principal, error)
}
