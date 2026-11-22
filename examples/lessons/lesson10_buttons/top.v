// Урок 10, задание «Цвет кнопками» (ключ): S1 — следующий цвет по кругу
// (R Y G C B M W), S2 — яркость 1 → 2 → 3 → 4 → 1 (40, 80, 120, 160).
// После прошивки — красный, яркость 1.
module top #(
    parameter integer CLK_HZ = 27_000_000,  // частота clk
    parameter integer DB_HZ  = 100          // опрос кнопок, раз в секунду; тестбенч ставит больше
) (
    input  wire clk,            // 27 МГц, вывод 4
    input  wire btn_s1,         // кнопка S1, вывод 88: следующий цвет
    input  wire btn_s2,         // кнопка S2, вывод 87: яркость
    output wire ws2812          // линия данных WS2812, вывод 79
);
    // ---------- Кнопки: как в уроках 7–8 ----------
    // Полярность кнопки: «нажата = 1» (проверено на плате, PULL_MODE=DOWN в top.cst).
    localparam PRESSED = 1'b1;
    wire s1_in = (btn_s1 == PRESSED);
    wire s2_in = (btn_s2 == PRESSED);

    reg s1_meta = 1'b0, s1_sync = 1'b0;
    reg s2_meta = 1'b0, s2_sync = 1'b0;

    always @(posedge clk) begin
        s1_meta <= s1_in;
        s1_sync <= s1_meta;
        s2_meta <= s2_in;
        s2_sync <= s2_meta;
    end

    localparam integer DB_LAST = CLK_HZ / DB_HZ - 1;    // 269 999 → 19 бит
    reg  [18:0] db_div = 19'd0;
    wire        db_tick = (db_div == DB_LAST);

    always @(posedge clk) begin
        if (db_tick) db_div <= 19'd0;
        else         db_div <= db_div + 1'b1;
    end

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

    // ---------- Цвет и яркость ----------
    reg [2:0] c     = 3'd0;     // номер цвета 0..6
    reg [1:0] level = 2'd0;     // яркость 0..3 (на экране 1..4)

    always @(posedge clk) begin
        if (s1_press) c <= (c == 3'd6) ? 3'd0 : c + 1'b1;    // по кругу
        if (s2_press) level <= level + 1'b1;                 // 3 → 0 само: 2 бита
    end

    wire [7:0] bright = (level + 1'b1) * 8'd40;              // 40, 80, 120, 160

    reg [2:0] mask;             // НЕ регистр: {красный, зелёный, синий}

    always @(*) begin
        case (c)
            3'd0:    mask = 3'b100;     // красный
            3'd1:    mask = 3'b110;     // жёлтый
            3'd2:    mask = 3'b010;     // зелёный
            3'd3:    mask = 3'b011;     // голубой
            3'd4:    mask = 3'b001;     // синий
            3'd5:    mask = 3'b101;     // пурпурный
            3'd6:    mask = 3'b111;     // белый
            default: mask = 3'b000;
        endcase
    end

    ws2812_tx #(.CLK_HZ(CLK_HZ)) led0 (
        .clk   (clk),
        .start (1'b1),
        .r     (mask[2] ? bright : 8'd0),
        .g     (mask[1] ? bright : 8'd0),
        .b     (mask[0] ? bright : 8'd0),
        .dout  (ws2812),
        .busy  ()
    );
endmodule
