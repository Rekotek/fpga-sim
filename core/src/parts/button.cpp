// Button and switch (spec section 6.2). One contact model: the button takes the commands
// press and release, the switch takes the command set.
#include "parts.h"

namespace fpgasim {

namespace {

constexpr int kRoleOut = 0;
constexpr uint32_t kTagToggle = 1;
constexpr uint32_t kTagFinal = 2;
constexpr Time kPsPerMs = 1'000'000'000ull;
constexpr Time kBounceMinPs = 50'000'000ull;     // 50 us
constexpr Time kBounceMaxPs = 2'000'000'000ull;  // 2 ms

class Contact final : public Part {
public:
    void attach(PartHost& host, const Json& settings) override {
        host_ = &host;
        readSettings(settings);
    }

    void reset() override {
        host_->cancelWake(kTagToggle);
        host_->cancelWake(kTagFinal);
        pressed_ = false;
        closed_ = false;
        apply();
        host_->markDirty();
    }

    void onCommand(std::string_view cmd, const Json& args) override {
        if (cmd == "press") {
            setPressed(true);
        } else if (cmd == "release") {
            setPressed(false);
        } else if (cmd == "set") {
            setPressed(args.value("on", false));
        }
    }

    void onWake(uint32_t tag, Time) override {
        if (tag == kTagFinal) {
            closed_ = pressed_;
            apply();
            return;
        }
        closed_ = !closed_;
        apply();
        scheduleBounce();
    }

    void onSettings(const Json& settings) override {
        readSettings(settings);
        apply();
    }

    void writeState(ByteWriter& out) const override { out.u8(pressed_ ? 1 : 0); }

private:
    void readSettings(const Json& settings) {
        activeLevel_ = settings.value("activeLevel", 1) != 0;
        driveIdle_ = settings.value("idle", "release") == "drive";
        bouncePs_ = static_cast<Time>(settings.value("bounceMs", 0.0) * static_cast<double>(kPsPerMs));
    }

    void setPressed(bool pressed) {
        if (pressed == pressed_) return;
        pressed_ = pressed;
        host_->markDirty();
        host_->cancelWake(kTagToggle);
        host_->cancelWake(kTagFinal);
        // The contact moves to the new position at once; with bounce it then switches randomly
        // until the given time ends and settles in the final position.
        closed_ = pressed;
        apply();
        if (bouncePs_ > 0) {
            bounceEnd_ = host_->now() + bouncePs_;
            scheduleBounce();
        }
    }

    void scheduleBounce() {
        const Time step = kBounceMinPs + host_->random() % (kBounceMaxPs - kBounceMinPs + 1);
        const Time next = host_->now() + step;
        if (next >= bounceEnd_) {
            host_->wakeAt(bounceEnd_, kTagFinal);
        } else {
            host_->wakeAt(next, kTagToggle);
        }
    }

    // A closed contact gives the active level; an open one follows the idle setting.
    void apply() {
        if (closed_) {
            host_->drive(kRoleOut, activeLevel_);
        } else if (driveIdle_) {
            host_->drive(kRoleOut, !activeLevel_);
        } else {
            host_->release(kRoleOut);
        }
    }

    PartHost* host_ = nullptr;
    bool activeLevel_ = true;
    bool driveIdle_ = false;
    Time bouncePs_ = 0;
    Time bounceEnd_ = 0;
    bool pressed_ = false;  // position set by the command
    bool closed_ = false;   // contact position including bounce
};

}  // namespace

std::unique_ptr<Part> makeButton() { return std::make_unique<Contact>(); }
std::unique_ptr<Part> makeSwitch() { return std::make_unique<Contact>(); }

}  // namespace fpgasim
