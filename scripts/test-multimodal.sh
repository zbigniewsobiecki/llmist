#!/bin/bash
#
# Test all image and speech generation models with hilarious prompts!
#
# Run: ./scripts/test-multimodal.sh
#
# This script generates fun images and speech samples across all supported models
# to verify the multimodal implementation works correctly.

set -e  # Exit on error

# Colors for pretty output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Output directory
OUTPUT_DIR="/tmp/llmist-multimodal-test-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUTPUT_DIR"

echo -e "${PURPLE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${PURPLE}║   🎨 llmist Multimodal Generation Test Suite 🎤              ║${NC}"
echo -e "${PURPLE}╠═══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${PURPLE}║   Output directory: ${OUTPUT_DIR}${NC}"
echo -e "${PURPLE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Track results
SUCCESSES=0
FAILURES=0
declare -a FAILED_TESTS=()

# Function to run a test
run_test() {
    local type="$1"
    local model="$2"
    local description="$3"
    local output_file="$4"
    shift 4
    local args=("$@")

    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Testing:${NC} $description"
    echo -e "${BLUE}Model:${NC} $model"
    echo -e "${BLUE}Output:${NC} $output_file"
    echo ""

    if bun src/cli.ts "$type" "${args[@]}" -m "$model" -o "$output_file" 2>&1; then
        echo -e "${GREEN}✓ Success!${NC}"
        ((SUCCESSES++))

        # Show file size
        if [[ -f "$output_file" ]]; then
            size=$(ls -lh "$output_file" | awk '{print $5}')
            echo -e "${BLUE}File size:${NC} $size"
        fi
    else
        echo -e "${RED}✗ Failed!${NC}"
        ((FAILURES++))
        FAILED_TESTS+=("$type:$model - $description")
    fi
    echo ""
}

# ═══════════════════════════════════════════════════════════════════════════════
# IMAGE GENERATION TESTS
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${PURPLE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${PURPLE}║                    🎨 IMAGE GENERATION                        ║${NC}"
echo -e "${PURPLE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# DALL-E 3 - The flagship
run_test "image" "dall-e-3" \
    "DALL-E 3: A sophisticated cat wearing a monocle and top hat, sipping tea at a tiny Victorian desk while debugging code on a miniature laptop" \
    "$OUTPUT_DIR/dalle3-fancy-cat.png" \
    "A sophisticated cat wearing a monocle and top hat, sipping tea at a tiny Victorian desk while debugging code on a miniature laptop, digital art, highly detailed"

# DALL-E 3 HD - Higher quality
run_test "image" "dall-e-3" \
    "DALL-E 3 HD: An astronaut riding a unicorn through a field of giant donuts in space" \
    "$OUTPUT_DIR/dalle3-hd-space-donut.png" \
    --quality hd \
    "An astronaut riding a majestic unicorn through a surreal field of giant glazed donuts floating in deep space, stars and galaxies in background, cinematic lighting"

# DALL-E 2 - The classic (if available)
run_test "image" "dall-e-2" \
    "DALL-E 2: A family of rubber ducks enjoying a bubble bath" \
    "$OUTPUT_DIR/dalle2-duck-family.png" \
    "A cheerful family of yellow rubber ducks floating in a bubbly bathtub, pastel colors, cozy bathroom setting, cartoon illustration style"

# GPT Image 1 - The new hotness (if available)
run_test "image" "gpt-image-1" \
    "GPT Image 1: A philosopher penguin contemplating the meaning of fish" \
    "$OUTPUT_DIR/gpt-image-philosopher-penguin.png" \
    "A penguin in ancient Greek philosopher robes, sitting on a marble pillar under a starry sky, contemplating a floating fish with deep philosophical intensity, dramatic chiaroscuro lighting"

# ═══════════════════════════════════════════════════════════════════════════════
# GEMINI IMAGE GENERATION TESTS (requires GEMINI_API_KEY)
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${PURPLE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${PURPLE}║               🎨 GEMINI IMAGE GENERATION                      ║${NC}"
echo -e "${PURPLE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Gemini Imagen 3 - Google's flagship
run_test "image" "imagen-3.0-generate-002" \
    "Imagen 3: A robot chef cooking a gourmet meal in a high-tech kitchen" \
    "$OUTPUT_DIR/imagen3-robot-chef.png" \
    "A friendly robot chef with chrome body and LED eyes, carefully cooking a gourmet meal in a futuristic kitchen, steam rising from pots, holographic recipe display, warm lighting"

# Gemini Imagen 3 - Different aspect ratio
run_test "image" "imagen-3.0-generate-002" \
    "Imagen 3 (16:9): Epic dragon flying over a medieval castle" \
    "$OUTPUT_DIR/imagen3-dragon-castle.png" \
    --size 16:9 \
    "A majestic fire-breathing dragon soaring over a medieval stone castle at sunset, mountains in the background, dramatic clouds, fantasy art style"

# Gemini Imagen 3 - Portrait orientation
run_test "image" "imagen-3.0-generate-002" \
    "Imagen 3 (9:16): A magical forest portal" \
    "$OUTPUT_DIR/imagen3-forest-portal.png" \
    --size 9:16 \
    "A mystical glowing portal hidden among ancient trees in an enchanted forest, fireflies and magical particles floating, moonlight streaming through branches"

# ═══════════════════════════════════════════════════════════════════════════════
# SPEECH GENERATION TESTS
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${PURPLE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${PURPLE}║                    🎤 SPEECH GENERATION                       ║${NC}"
echo -e "${PURPLE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# TTS-1 with different voices - Fun announcements
run_test "speech" "tts-1" \
    "TTS-1 (nova): Dramatic movie trailer voice" \
    "$OUTPUT_DIR/tts1-nova-trailer.mp3" \
    --voice nova \
    "In a world where bugs lurk in every codebase... One developer stands alone... Armed with nothing but a keyboard and excessive caffeine... This summer... Prepare for... THE REFACTORING."

run_test "speech" "tts-1" \
    "TTS-1 (onyx): Deep philosophical musings" \
    "$OUTPUT_DIR/tts1-onyx-philosophy.mp3" \
    --voice onyx \
    "To ship or not to ship, that is the question. Whether 'tis nobler in the mind to suffer the slings and arrows of outrageous deadlines, or to take arms against a sea of technical debt."

run_test "speech" "tts-1" \
    "TTS-1 (echo): Excited startup pitch" \
    "$OUTPUT_DIR/tts1-echo-startup.mp3" \
    --voice echo \
    "Okay, hear me out. What if, and stay with me here, what if we made an app that's like Uber, but for socks? We call it Sockr. Disrupting the footwear industry, one foot at a time!"

run_test "speech" "tts-1" \
    "TTS-1 (fable): Bedtime story narrator" \
    "$OUTPUT_DIR/tts1-fable-story.mp3" \
    --voice fable \
    "Once upon a time, in a land of infinite loops, there lived a young function named Fibonacci. Every day, Fibonacci would call upon himself, again and again, until the stack grew so tall it touched the clouds."

run_test "speech" "tts-1" \
    "TTS-1 (shimmer): Upbeat weather report" \
    "$OUTPUT_DIR/tts1-shimmer-weather.mp3" \
    --voice shimmer \
    "Good morning! Today's forecast calls for scattered commits with a chance of merge conflicts! Temperatures will hover around 404 degrees. Don't forget your error handling umbrella!"

run_test "speech" "tts-1" \
    "TTS-1 (alloy): Calm meditation guide" \
    "$OUTPUT_DIR/tts1-alloy-meditation.mp3" \
    --voice alloy \
    "Take a deep breath. Release all tension from your shoulders. Let go of the memory leaks. Feel the garbage collector washing over you. Your mind is now as clean as freshly formatted code."

# TTS-1-HD - Higher quality versions
run_test "speech" "tts-1-hd" \
    "TTS-1-HD (nova): Epic fantasy quest intro" \
    "$OUTPUT_DIR/tts1-hd-nova-fantasy.mp3" \
    --voice nova \
    "Hark! The ancient scroll of Documentation hath been lost! Only the chosen Debugger can venture into the depths of Legacy Code Mountain to retrieve it. May your console logs guide you, brave warrior!"

run_test "speech" "tts-1-hd" \
    "TTS-1-HD (onyx): Cooking show host" \
    "$OUTPUT_DIR/tts1-hd-onyx-cooking.mp3" \
    --voice onyx \
    "Today on Cooking with Code, we'll be preparing a delicious Spaghetti Architecture with a side of Callback Hell. First, we need three cups of nested promises and a generous helping of technical debt. Bon appétit!"

# Slower and faster speech tests
run_test "speech" "tts-1" \
    "TTS-1 (nova, slow): Dramatic slow reading" \
    "$OUTPUT_DIR/tts1-slow-dramatic.mp3" \
    --voice nova --speed 0.8 \
    "And then... the server... went down. The logs grew silent. Somewhere, a developer wept."

run_test "speech" "tts-1" \
    "TTS-1 (echo, fast): Excited speed reader" \
    "$OUTPUT_DIR/tts1-fast-excited.mp3" \
    --voice echo --speed 1.5 \
    "Oh my gosh the tests are passing! All green! Ship it ship it ship it! Deploy deploy deploy! Wait what's that red thing NO NO NO ROLLBACK ROLLBACK!"

# ═══════════════════════════════════════════════════════════════════════════════
# GEMINI SPEECH GENERATION TESTS (requires GEMINI_API_KEY)
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${PURPLE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${PURPLE}║               🎤 GEMINI SPEECH GENERATION                     ║${NC}"
echo -e "${PURPLE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Gemini 2.5 Flash TTS - Different voices
run_test "speech" "gemini-2.5-flash-preview-tts" \
    "Gemini Flash TTS (Zephyr): Bright storyteller" \
    "$OUTPUT_DIR/gemini-flash-zephyr.wav" \
    --voice Zephyr \
    "Welcome to the future of text to speech! I am Zephyr, your bright and cheerful guide through the wonderful world of AI-generated audio."

run_test "speech" "gemini-2.5-flash-preview-tts" \
    "Gemini Flash TTS (Charon): Informative narrator" \
    "$OUTPUT_DIR/gemini-flash-charon.wav" \
    --voice Charon \
    "In the annals of software development, few moments rival the satisfaction of seeing all tests pass. Today, we celebrate that milestone."

run_test "speech" "gemini-2.5-flash-preview-tts" \
    "Gemini Flash TTS (Fenrir): Excitable announcer" \
    "$OUTPUT_DIR/gemini-flash-fenrir.wav" \
    --voice Fenrir \
    "BREAKING NEWS! Scientists have discovered that rubber ducks debug code fifty percent faster than traditional methods! More at eleven!"

run_test "speech" "gemini-2.5-flash-preview-tts" \
    "Gemini Flash TTS (Aoede): Breezy meditation" \
    "$OUTPUT_DIR/gemini-flash-aoede.wav" \
    --voice Aoede \
    "Close your eyes. Breathe deeply. Let go of all merge conflicts. Your branches are now perfectly synchronized. Inner peace achieved."

# Gemini 2.5 Pro TTS - Higher quality voice
run_test "speech" "gemini-2.5-pro-preview-tts" \
    "Gemini Pro TTS (Sulafat): Warm bedtime story" \
    "$OUTPUT_DIR/gemini-pro-sulafat.wav" \
    --voice Sulafat \
    "Once upon a time, in a data center far, far away, there lived a brave little microservice named Redis. Redis could remember everything, and helped all the other services find their way home."

run_test "speech" "gemini-2.5-pro-preview-tts" \
    "Gemini Pro TTS (Gacrux): Mature documentary voice" \
    "$OUTPUT_DIR/gemini-pro-gacrux.wav" \
    --voice Gacrux \
    "The migration patterns of legacy code remain one of nature's greatest mysteries. Here we observe a rare jQuery plugin, still alive in the wild, decades after its prime."

# ═══════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${PURPLE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${PURPLE}║                        📊 RESULTS                             ║${NC}"
echo -e "${PURPLE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}✓ Successes: $SUCCESSES${NC}"
echo -e "${RED}✗ Failures: $FAILURES${NC}"
echo ""

if [[ ${#FAILED_TESTS[@]} -gt 0 ]]; then
    echo -e "${RED}Failed tests:${NC}"
    for test in "${FAILED_TESTS[@]}"; do
        echo -e "  ${RED}•${NC} $test"
    done
    echo ""
fi

echo -e "${BLUE}Output files are in:${NC} $OUTPUT_DIR"
echo ""

# List all generated files
echo -e "${CYAN}Generated files:${NC}"
ls -lh "$OUTPUT_DIR"/ 2>/dev/null || echo "  (no files generated)"
echo ""

# Calculate total cost estimate
echo -e "${YELLOW}📝 Note: Check your API provider dashboard for actual costs.${NC}"
echo -e "${YELLOW}   Rough estimates: Images ~$0.04-0.17 each, Speech ~$0.001-0.01 each${NC}"
echo ""

# Final message
if [[ $FAILURES -eq 0 ]]; then
    echo -e "${GREEN}🎉 All tests passed! Your multimodal setup is working perfectly!${NC}"
    echo -e "${GREEN}   Open the output directory to enjoy your hilarious creations!${NC}"
else
    echo -e "${YELLOW}⚠️  Some tests failed. This might be due to:${NC}"
    echo -e "${YELLOW}   • Missing API keys (OPENAI_API_KEY, GEMINI_API_KEY)${NC}"
    echo -e "${YELLOW}   • Model not available in your API plan${NC}"
    echo -e "${YELLOW}   • Rate limiting${NC}"
fi

echo ""
echo -e "${PURPLE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${PURPLE}║   🎬 Thanks for using llmist multimodal! 🎬                   ║${NC}"
echo -e "${PURPLE}╚═══════════════════════════════════════════════════════════════╝${NC}"
