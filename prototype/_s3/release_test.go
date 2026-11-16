package service

import "testing"

func TestVersionNo(t *testing.T) {
	cases := map[string]int32{"v1": 1, "v12": 12, "": 0, "garbage": 0, "v": 0}
	for in, want := range cases {
		if got := versionNo(in); got != want {
			t.Errorf("versionNo(%q)=%d want %d", in, got, want)
		}
	}
}

func TestNodeIdentityPathIsWhitelisted(t *testing.T) {
	for typ, want := range map[string]string{
		"relay":   "/opt/mihomo/conf/node-identity.yaml",
		"landing": "/opt/hysteria/conf/node-identity.yaml",
	} {
		got, err := nodeIdentityPath(typ)
		if err != nil || got != want {
			t.Errorf("nodeIdentityPath(%q)=%q err=%v", typ, got, err)
		}
	}
	if _, err := nodeIdentityPath("control"); err == nil {
		t.Fatal("P0 must reject service_type outside relay/landing")
	}
}

func TestAppKeyPattern(t *testing.T) {
	for _, k := range []string{"mihomo-relay", "hysteria2-landing", "a1"} {
		if !appKeyPattern.MatchString(k) {
			t.Errorf("expected %q valid", k)
		}
	}
	for _, k := range []string{"", "A", "Upper", "a", "has space", "-lead", "x;rm"} {
		if appKeyPattern.MatchString(k) {
			t.Errorf("expected %q rejected", k)
		}
	}
}
