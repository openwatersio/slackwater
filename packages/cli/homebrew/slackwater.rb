class Slackwater < Formula
  desc "Tide prediction command-line interface"
  homepage "https://github.com/{{REPO}}"
  version "{{VERSION}}"
  license "MIT"

  # Releases ship only an Apple Silicon macOS binary and an x86_64 Linux binary. Every
  # platform still declares a url so the formula loads everywhere; depends_on refuses the rest.
  on_macos do
    depends_on arch: :arm64

    on_arm do
      url "https://github.com/{{REPO}}/releases/download/{{TAG}}/slackwater-darwin-arm64.tar.gz"
      sha256 "{{SHA256_DARWIN_ARM64}}"
    end
    on_intel do
      url "https://github.com/{{REPO}}/releases/download/{{TAG}}/slackwater-darwin-arm64.tar.gz"
      sha256 "{{SHA256_DARWIN_ARM64}}"
    end
  end

  on_linux do
    depends_on arch: :x86_64

    on_intel do
      url "https://github.com/{{REPO}}/releases/download/{{TAG}}/slackwater-linux-x64.tar.gz"
      sha256 "{{SHA256_LINUX_X64}}"
    end
    on_arm do
      url "https://github.com/{{REPO}}/releases/download/{{TAG}}/slackwater-linux-x64.tar.gz"
      sha256 "{{SHA256_LINUX_X64}}"
    end
  end

  def install
    bin.install "slackwater"
    prefix.install "LICENSE", "NOTICE"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/slackwater --version")
  end
end
