// Урок 8, практика 2: яркость LED0 кнопками. S1 — ярче, S2 — тусклее.
// 16 уровней яркости (0..15); на краях уровень не меняется (насыщение).
// LED1..LED4 показывают номер уровня в двоичном виде.
module top #(
    parameter integer CLK_HZ = 27_000_000   // частота clk; тестбенч ставит меньше
) (
    input  wire       clk,      // 27 МГц, вывод 4
    input  wire       btn_s1,   // кнопка S1, вывод 88: ярче
    input  wire       btn_s2,   // кнопка S2, вывод 87: тусклее
    output wire [5:0] led       // LED0..LED5, выводы 15..20, горят при 0
);
    // ---------- Вход: кнопки, как в уроке 7 (замок) ----------
    // Полярность кнопки: «нажата = 1» — проверено на плате.
    localparam PRESSED = 1'b1;
    wire s1_in = (btn_s1 == PRESSED);
    wire s2_in = (btn_s2 == PRESSED);

    // Синхронизаторы: по два триггера на каждую кнопку.
    reg s1_meta = 1'b0, s1_sync = 1'b0;
    reg s2_meta = 1'b0, s2_sync = 1'b0;

    always @(posedge clk) begin
        s1_meta <= s1_in;
        s1_sync <= s1_meta;
        s2_meta <= s2_in;
        s2_sync <= s2_meta;
    end

    // Делитель антидребезга: тик раз в 10 мс, один на обе кнопки.
    localparam integer DB_LAST = CLK_HZ / 100 - 1;   // 269 999 → 19 бит
    reg  [18:0] db_div = 19'd0;
    wire        db_tick = (db_div == DB_LAST);

    always @(posedge clk) begin
        if (db_tick) db_div <= 19'd0;
        else         db_div <= db_div + 1'b1;
    end

    // Антидребезг и детекторы фронта: s1_press и s2_press — «тики от кнопок».
    reg s1_db = 1'b0, s2_db = 1'b0, s1_prev = 1'b0, s2_prev = 1'b0;

    always @(posedge clk) begin
        if (db_tick) begin
            s1_db <= s1_sync;
            s2_db <= s2_sync;
        end
        s1_prev <= s1_db;
        s2_prev <= s2_db;
    end

    wire s1_press = s1_db & ~s1_prev;
    wire s2_press = s2_db & ~s2_prev;

    // ---------- Уровень яркости ----------
    localparam [3:0] MAX = 4'd15;
    reg [3:0] level = 4'd8;               // после прошивки — середина

    always @(posedge clk) begin
        if (s1_press) begin
            if (level != MAX) level <= level + 1'b1;   // на 15 стоим
        end else if (s2_press) begin
            if (level != 4'd0) level <= level - 1'b1;  // на 0 стоим
        end
    end

    // Уровень → коэффициент заполнения: 0, 17, 34, …, 255 (15 × 17 = 255).
    wire [7:0] duty = level * 8'd17;

    // ---------- ШИМ: счётчик + компаратор ----------
    reg [7:0] cnt = 8'd0;

    always @(posedge clk)
        cnt <= cnt + 1'b1;

    wire pwm = (cnt < duty);

    // LED0 — ШИМ, LED1..LED4 — номер уровня, LED5 погашен.
    assign led = ~{1'b0, level, pwm};
endmodule
