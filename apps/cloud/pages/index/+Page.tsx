import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@schemaful/ui";
import { Cloud, Zap, Shield, Globe } from "lucide-react";

export default function Page() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      {/* Header */}
      <header className="border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Cloud className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-semibold">Schemaful Cloud</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="/auth/signin" className="text-sm text-muted-foreground hover:text-foreground">
              Sign in
            </a>
            <Button asChild>
              <a href="/auth/signup">Get Started</a>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 py-24 text-center">
        <h1 className="text-5xl font-bold tracking-tight">
          The Modern Headless CMS
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-xl text-muted-foreground">
          Build content-driven applications with a powerful, flexible CMS.
          Define schemas, manage content, and deliver via API.
        </p>
        <div className="mt-10 flex justify-center gap-4">
          <Button size="lg" asChild>
            <a href="/auth/signup">Start Free Trial</a>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <a href="https://github.com/schemaful/schemaful" target="_blank" rel="noopener">
              View on GitHub
            </a>
          </Button>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-6 md:grid-cols-3">
          <Card>
            <CardHeader>
              <Zap className="h-10 w-10 text-primary" />
              <CardTitle className="mt-4">Lightning Fast</CardTitle>
              <CardDescription>
                Built on edge infrastructure for instant content delivery worldwide.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <Shield className="h-10 w-10 text-primary" />
              <CardTitle className="mt-4">Enterprise Security</CardTitle>
              <CardDescription>
                SOC 2 compliant with role-based access control and audit logging.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <Globe className="h-10 w-10 text-primary" />
              <CardTitle className="mt-4">Multi-language</CardTitle>
              <CardDescription>
                Full localization support with fallback chains and locale management.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t bg-muted/30 py-16">
        <div className="mx-auto max-w-6xl px-4 text-center">
          <h2 className="text-3xl font-bold">Ready to get started?</h2>
          <p className="mt-4 text-muted-foreground">
            Create your workspace and start building in minutes.
          </p>
          <Button size="lg" className="mt-8" asChild>
            <a href="/auth/signup">Create Free Account</a>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="mx-auto max-w-6xl px-4 text-center text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} Schemaful. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
