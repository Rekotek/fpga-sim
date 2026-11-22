// Урок 8, практика 3: яркость кнопками с гамма-таблицей.
// Как практика 2, но уровень 0..15 переводится в duty не умножением на 17,
// а таблицей: шаги яркости кажутся глазу одинаковыми.
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

    // Уровень → коэффициент заполнения по гамма-таблице (гамма 2,2):
    // duty = 255 × (level / 15)^2,2, округлено до целого.
    reg [7:0] duty;              // НЕ регистр: присваивается в always @(*)

    always @(*) begin
        duty = 8'd0;             // по умолчанию — погашен
        case (level)
            4'd0:  duty = 8'd0;
            4'd1:  duty = 8'd1;
            4'd2:  duty = 8'd3;
            4'd3:  duty = 8'd7;
            4'd4:  duty = 8'd14;
            4'd5:  duty = 8'd23;
            4'd6:  duty = 8'd34;
            4'd7:  duty = 8'd48;
            4'd8:  duty = 8'd64;
            4'd9:  duty = 8'd83;
            4'd10: duty = 8'd105;
            4'd11: duty = 8'd129;
            4'd12: duty = 8'd156;
            4'd13: duty = 8'd186;
            4'd14: duty = 8'd219;
            4'd15: duty = 8'd255;
            default: duty = 8'd0;
        endcase
    end

    // ---------- ШИМ: счётчик + компаратор ----------
    reg [7:0] cnt = 8'd0;

    always @(posedge clk)
        cnt <= cnt + 1'b1;

    wire pwm = (cnt < duty);

    // LED0 — ШИМ, LED1..LED4 — номер уровня, LED5 погашен.
    assign led = ~{1'b0, level, pwm};
endmodule
