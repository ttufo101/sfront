package auth

import (
	"errors"
	"fmt"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

type accessClaims struct {
	UserID    string `json:"UserId"`
	TokenType string `json:"token_type"`
	jwt.RegisteredClaims
}

type JWTVerifier struct {
	issuer string
	key    []byte
}

func NewJWTVerifier(issuer, secret string) (*JWTVerifier, error) {
	issuer = strings.TrimSpace(issuer)
	if issuer == "" || secret == "" {
		return nil, errors.New("JWT_ISSUER and JWT_SECRET are required")
	}
	return &JWTVerifier{issuer: issuer, key: []byte(secret)}, nil
}

func (v *JWTVerifier) Verify(rawToken string) (Principal, error) {
	claims := &accessClaims{}
	// 算法白名单与方法实例双重检查，避免攻击者通过 JWT header 切换签名算法。
	token, err := jwt.ParseWithClaims(
		rawToken,
		claims,
		func(token *jwt.Token) (any, error) {
			if token.Method != jwt.SigningMethodHS256 {
				return nil, fmt.Errorf("unexpected signing method: %s", token.Method.Alg())
			}
			return v.key, nil
		},
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(v.issuer),
	)
	if err != nil {
		// 与 Gateway 保持一致：过期和尚未生效统一归为时间无效，其余解析错误不暴露细节。
		if errors.Is(err, jwt.ErrTokenExpired) || errors.Is(err, jwt.ErrTokenNotValidYet) {
			return Principal{}, ErrTokenExpired
		}
		return Principal{}, ErrTokenInvalid
	}
	if token == nil || !token.Valid || claims.TokenType != "access" {
		return Principal{}, ErrTokenInvalid
	}
	userID := strings.TrimSpace(claims.UserID)
	if userID == "" {
		return Principal{}, ErrTokenInvalid
	}
	return Principal{UserID: userID}, nil
}
