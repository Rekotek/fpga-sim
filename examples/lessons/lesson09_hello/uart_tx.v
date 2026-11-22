// Урок 9: передатчик UART, кадр 8N1 (старт-бит, 8 бит данных младшим вперёд, стоп-бит).
// По импульсу start (один такт) запоминает байт data и выдвигает его в линию tx.
// Пока идёт кадр, busy = 1 и новые start не принимаются.
module uart_tx #(
    parameter integer CLK_HZ = 27_000_000,  // частота clk
    parameter integer BAUD   = 115_200      // скорость линии, бод
) (
    input  wire       clk,
    input  wire       start,    // 1 на один такт: «отправь data»
    input  wire [7:0] data,     // байт для отправки
    output reg        tx = 1'b1, // линия UART: в покое 1
    output wire       busy      // 1, пока идёт кадр
);
    // Длительность одного бита в тактах: 27 000 000 / 115 200 = 234 (остаток отброшен).
    localparam integer BIT_LAST = CLK_HZ / BAUD - 1;   // 233 → 8 бит

    // Состояния автомата.
    localparam [1:0] S_IDLE  = 2'd0,    // линия в покое, ждём start
                     S_START = 2'd1,    // старт-бит: 0
                     S_DATA  = 2'd2,    // 8 бит данных, младший первым
                     S_STOP  = 2'd3;    // стоп-бит: 1

    reg [1:0] state = S_IDLE;
    reg [1:0] next;             // НЕ регистр: присваивается в always @(*)
    reg       line;             // НЕ регистр: что должно быть на линии сейчас
    reg [7:0] div = 8'd0;       // таймер бита: 0..BIT_LAST
    reg [2:0] n   = 3'd0;       // номер бита данных: 0..7
    reg [7:0] sr  = 8'd0;       // сдвиговый регистр: младший бит — следующий на выход

    wire bit_end = (div == BIT_LAST);   // последний такт текущего бита

    // Блок 1 — комбинационный: куда идти и что выдавать в линию.
    always @(*) begin
        next = state;
        line = 1'b1;                            // по умолчанию — покой
        case (state)
            S_IDLE:  if (start) next = S_START;
            S_START: begin
                         line = 1'b0;
                         if (bit_end) next = S_DATA;
                     end
            S_DATA:  begin
                         line = sr[0];
                         if (bit_end && n == 3'd7) next = S_STOP;
                     end
            S_STOP:  if (bit_end) next = S_IDLE;
            default: next = S_IDLE;
        endcase
    end

    // Блок 2 — тактовый.
    always @(posedge clk) begin
        state <= next;
        tx    <= line;                          // выход — из триггера: без «иголок»

        // Таймер бита: заново в начале каждого бита.
        if (next != state || bit_end) div <= 8'd0;
        else                          div <= div + 1'b1;

        if (state == S_IDLE) begin
            n <= 3'd0;
            if (start) sr <= data;              // запомнить байт
        end else if (state == S_DATA && bit_end) begin
            n  <= n + 1'b1;
            sr <= {1'b0, sr[7:1]};              // сдвиг вправо: следующий бит в sr[0]
        end
    end

    assign busy = (state != S_IDLE);
endmodule
