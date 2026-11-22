// Урок 10, практика 4: «дыхание» цвета. Яркость v плавно растёт и падает
// (автомат ВДОХ/ВЫДОХ из урока 8), глазу ровнее помогает гамма 2 — квадрат
// (★ из урока 8). На каждом новом вдохе цвет меняется: R → Y → G → C → B → M.
module top #(
    parameter integer CLK_HZ  = 27_000_000, // частота clk
    parameter integer STEP_HZ = 256         // шагов яркости в секунду; тестбенч ставит больше
) (
    input  wire clk,            // 27 МГц, вывод 4
    output wire ws2812          // линия данных WS2812, вывод 79
);
    // ---------- Таймер: тик 256 раз в секунду (урок 8) ----------
    localparam integer LAST = CLK_HZ / STEP_HZ - 1;  // 105 467 → 17 бит
    reg  [16:0] div = 17'd0;
    wire        tick = (div == LAST);

    always @(posedge clk) begin
        if (tick) div <= 17'd0;
        else      div <= div + 1'b1;
    end

    // ---------- Автомат ВДОХ/ВЫДОХ (урок 8) + номер цвета ----------
    localparam S_UP   = 1'b0,   // вдох: ярче
               S_DOWN = 1'b1;   // выдох: тусклее

    reg       state = S_UP;
    reg       next;             // НЕ регистр: присваивается в always @(*)
    reg [7:0] v = 8'd0;         // яркость до гаммы: 0..255
    reg [2:0] c = 3'd0;         // номер цвета: 0..5

    always @(*) begin
        next = state;
        case (state)
            S_UP:    if (v == 8'd255) next = S_DOWN;
            S_DOWN:  if (v == 8'd0)   next = S_UP;
            default: next = S_UP;
        endcase
    end

    always @(posedge clk) begin
        if (tick) begin
            state <= next;
            if (next == S_UP) v <= v + 1'b1;
            else              v <= v - 1'b1;
            if (state == S_DOWN && next == S_UP)          // дно: начинается новый вдох
                c <= (c == 3'd5) ? 3'd0 : c + 1'b1;       // 6 цветов по кругу
        end
    end

    // ---------- Гамма 2 и яркость не больше 127 ----------
    wire [15:0] sq = v * v;     // 0..65 025
    wire [7:0]  vg = sq[15:9];  // делим на 512: 0..127

    // Цвет по номеру: какие каналы включены {красный, зелёный, синий}.
    reg [2:0] mask;             // НЕ регистр: таблица

    always @(*) begin
        case (c)
            3'd0:    mask = 3'b100;     // красный
            3'd1:    mask = 3'b110;     // жёлтый
            3'd2:    mask = 3'b010;     // зелёный
            3'd3:    mask = 3'b011;     // голубой
            3'd4:    mask = 3'b001;     // синий
            3'd5:    mask = 3'b101;     // пурпурный
            default: mask = 3'b000;
        endcase
    end

    ws2812_tx #(.CLK_HZ(CLK_HZ)) led0 (
        .clk   (clk),
        .start (1'b1),
        .r     (mask[2] ? vg : 8'd0),
        .g     (mask[1] ? vg : 8'd0),
        .b     (mask[0] ? vg : 8'd0),
        .dout  (ws2812),
        .busy  ()
    );
endmodule
